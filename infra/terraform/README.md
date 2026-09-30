# Terraform
Estado: escrito, no aplicado.

Describe una VPC, subredes públicas para el balanceador, subredes privadas para Fargate y RDS, un NAT gateway, PostgreSQL 16 cifrado y tres secretos vacíos (`database-url`, `openai-api-key`, `jwt-secret`). No hay valores de secretos en estos archivos.

```powershell
terraform -chdir=infra/terraform init
terraform -chdir=infra/terraform validate
```

No ejecutes `apply` sin una cuenta, un certificado y una imagen publicada. El resultado de `validate` de esta sesión está en el reporte de QA. Si no figura PASS, no fue ejecutado.
