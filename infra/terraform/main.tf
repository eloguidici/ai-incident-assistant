resource "aws_db_subnet_group" "main" {
  name       = var.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "postgres" {
  identifier                  = var.name
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  db_name                     = "incident_assistant"
  username                    = "app"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.main.name
  vpc_security_group_ids      = [aws_security_group.db.id]
  publicly_accessible         = false
  storage_encrypted           = true
  backup_retention_period     = 7
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${var.name}-final"
}

resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.name}/database-url"
}

resource "aws_secretsmanager_secret" "llm" {
  name = "${var.name}/${var.llm_provider}-api-key"
}

resource "aws_secretsmanager_secret" "jwt" {
  name = "${var.name}/jwt-secret"
}

resource "aws_secretsmanager_secret" "pii" {
  name = "${var.name}/pii-hmac-key"
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_secretsmanager_secret.database_url.arn,
      aws_secretsmanager_secret.llm.arn,
      aws_secretsmanager_secret.jwt.arn,
      aws_secretsmanager_secret.pii.arn,
    ]
  }
}

resource "aws_iam_role_policy" "secrets" {
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.secrets.json
}

resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.name}"
  retention_in_days = 14
}

resource "aws_ecs_cluster" "main" {
  name = var.name
}

resource "aws_lb" "main" {
  name               = var.name
  load_balancer_type = "application"
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "web" {
  name        = var.name
  port        = 80
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id
  health_check {
    path = "/api/health"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  # Provisional local-model envelope; validate in AWS before enabling desired_count.
  cpu                = "1024"
  memory             = "4096"
  execution_role_arn = aws_iam_role.execution.arn
  task_role_arn      = aws_iam_role.task.arn
  container_definitions = jsonencode([
    {
      name         = "api"
      image        = var.container_image
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      dependsOn    = [{ containerName = "pii", condition = "HEALTHY" }]
      environment = concat([
        { name = "LLM_PROVIDER", value = var.llm_provider },
        { name = "PII_ENABLED", value = tostring(var.pii_enabled) },
        { name = "PII_PERSON_ENABLED", value = tostring(var.pii_person_enabled) },
        { name = "PII_SERVICE_URL", value = "http://127.0.0.1:8000" },
        { name = "PII_TIMEOUT_MS", value = "10000" },
        { name = "SOURCE_TEXT_MAX", value = tostring(var.source_text_max) },
        { name = "QUESTION_MAX", value = tostring(var.question_max) },
        { name = "WEB_ORIGIN", value = var.web_origin },
        { name = "PORT", value = "3000" },
        { name = "SEED_DEMO", value = "false" },
        { name = "COOKIE_SECURE", value = "true" },
        { name = "TRUST_PROXY", value = "true" }
        ], var.llm_model == "" ? [] : [
        { name = var.llm_provider == "openrouter" ? "OPENROUTER_MODEL" : "OPENAI_MODEL", value = var.llm_model }
      ])
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = var.llm_provider == "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY", valueFrom = aws_secretsmanager_secret.llm.arn },
        { name = "JWT_SECRET", valueFrom = aws_secretsmanager_secret.jwt.arn }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "api"
        }
      }
    },
    {
      name                   = "pii"
      image                  = var.pii_container_image
      essential              = true
      memory                 = 3072
      readonlyRootFilesystem = true
      environment = [
        { name = "PII_PERSON_ENABLED", value = tostring(var.pii_person_enabled) },
        { name = "HF_HUB_OFFLINE", value = "1" },
        { name = "TRANSFORMERS_OFFLINE", value = "1" }
      ]
      secrets = [{ name = "PII_HMAC_KEY", valueFrom = aws_secretsmanager_secret.pii.arn }]
      healthCheck = {
        command     = ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 120
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "pii"
        }
      }
    },
    {
      name         = "web"
      image        = var.web_container_image
      essential    = true
      portMappings = [{ containerPort = 80, protocol = "tcp" }]
      environment  = [{ name = "API_UPSTREAM", value = "127.0.0.1:3000" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "web"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = var.name
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 80
  }
  depends_on = [aws_lb_listener.https]
}

output "load_balancer_dns" {
  value = aws_lb.main.dns_name
}

output "database_address" {
  value = aws_db_instance.postgres.address
}


output "secret_arns" {
  description = "Secret containers only; populate versions outside Terraform. Never commit values."
  value = {
    database_url = aws_secretsmanager_secret.database_url.arn
    llm_api_key  = aws_secretsmanager_secret.llm.arn
    jwt_secret   = aws_secretsmanager_secret.jwt.arn
    pii_hmac_key = aws_secretsmanager_secret.pii.arn
  }
}
