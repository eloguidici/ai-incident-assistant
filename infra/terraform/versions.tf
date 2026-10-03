terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "name" {
  type    = string
  default = "ai-incident-assistant"
}

variable "container_image" {
  type        = string
  description = "Published application API image (prefer an immutable digest). No generic Node image fallback."
}

variable "web_origin" {
  type        = string
  description = "Public HTTPS origin whose DNS points to the ALB and whose hostname is covered by the ACM certificate."
  validation {
    condition     = can(regex("^https://[^/]+$", var.web_origin)) && !strcontains(var.web_origin, "localhost")
    error_message = "Use a public HTTPS origin without a trailing slash, not localhost."
  }
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for the ALB HTTPS listener (required before apply)."
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}


variable "web_container_image" {
  type        = string
  description = "Published React/nginx image built with infra/docker/web.Dockerfile."
}

variable "pii_container_image" {
  type        = string
  description = "Published offline local PII image built with services/pii/Dockerfile; prefer an immutable digest."
}

variable "llm_provider" {
  type        = string
  default     = "openrouter"
  description = "Real provider selected for the proposed deployment."
  validation {
    condition     = contains(["openai", "openrouter"], var.llm_provider)
    error_message = "Choose openai or openrouter."
  }
}

variable "llm_model" {
  type        = string
  default     = ""
  description = "Optional model override; empty uses the selected provider's application default."
}

variable "desired_count" {
  type        = number
  default     = 0
  description = "Keep zero until secret versions, images, TLS/DNS and user provisioning are ready."
  validation {
    condition     = var.desired_count >= 0 && floor(var.desired_count) == var.desired_count
    error_message = "desired_count must be a nonnegative integer."
  }
}

variable "source_text_max" {
  type        = number
  default     = 1000
  description = "Runtime incident character limit read by React. Increasing requires real detector latency QA."
  validation {
    condition     = var.source_text_max >= 20 && var.source_text_max <= 50000 && floor(var.source_text_max) == var.source_text_max
    error_message = "source_text_max must be an integer between 20 and 50000."
  }
}

variable "pii_enabled" {
  type        = bool
  default     = true
  description = "Operator-controlled content protection flag. False explicitly permits unprotected writes/provider payloads; not an outage fallback."
}

variable "pii_person_enabled" {
  type        = bool
  default     = true
  description = "Optional local name-model layer. False keeps detected emails/phones only and skips loading model weights."
}

variable "question_max" {
  type        = number
  default     = 500
  description = "Runtime follow-up character limit read by React. Increasing requires real detector latency QA."
  validation {
    condition     = var.question_max >= 1 && var.question_max <= 8000 && floor(var.question_max) == var.question_max
    error_message = "question_max must be an integer between 1 and 8000."
  }
}
