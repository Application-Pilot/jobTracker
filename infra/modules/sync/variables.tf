# =============================================================================
# variables.tf — Inputs to the sync pipeline module
# =============================================================================

variable "project" {
  description = "Project name prefix for resource naming (e.g., 'jobtracker')."
  type        = string
}

variable "environment" {
  description = "Environment name (e.g., 'dev', 'prod')."
  type        = string
}

variable "lambda_runtime" {
  description = "Lambda runtime for the scheduler and worker functions."
  type        = string
  default     = "nodejs20.x"
}

variable "users_table_name" {
  description = "Name of the DynamoDB users table."
  type        = string
}

variable "users_table_arn" {
  description = "ARN of the DynamoDB users table."
  type        = string
}

variable "applications_table_name" {
  description = "Name of the DynamoDB applications table."
  type        = string
}

variable "applications_table_arn" {
  description = "ARN of the DynamoDB applications table."
  type        = string
}

variable "sync_state_table_name" {
  description = "Name of the DynamoDB sync_state table."
  type        = string
}

variable "sync_state_table_arn" {
  description = "ARN of the DynamoDB sync_state table."
  type        = string
}

variable "token_kms_key_arn" {
  description = "ARN of the KMS key used to decrypt Gmail refresh tokens."
  type        = string
}

variable "gmail_oauth_client_id" {
  description = "Google OAuth 2.0 Client ID used for Gmail token refresh."
  type        = string
  sensitive   = true
}

variable "gmail_oauth_client_secret" {
  description = "Google OAuth 2.0 Client Secret used for Gmail token refresh."
  type        = string
  sensitive   = true
}

variable "scheduler_zip_path" {
  description = "Path to the built scheduler Lambda zip."
  type        = string
}

variable "worker_zip_path" {
  description = "Path to the built sync worker Lambda zip."
  type        = string
}
