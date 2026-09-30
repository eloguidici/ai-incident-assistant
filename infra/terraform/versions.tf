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
  type    = string
  default = "http://localhost"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}
