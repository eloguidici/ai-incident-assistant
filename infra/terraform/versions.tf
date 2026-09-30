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
  description = "Imagen ya publicada. Este stack no la construye ni la sube."
  default     = "public.ecr.aws/docker/library/node:22-alpine"
}

variable "web_origin" {
  type        = string
  description = "Public browser origin served over HTTPS (must match the ALB TLS endpoint for COOKIE_SECURE)."
  default     = "https://localhost"
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN for the ALB HTTPS listener (required before apply)."
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
