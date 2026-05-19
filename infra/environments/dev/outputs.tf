# =============================================================================
# outputs.tf — Values surfaced after `terraform apply`
# =============================================================================
#
# Outputs are printed at the end of an apply and queryable via
# `terraform output <name>`. They serve two purposes:
#
#   1. Human-readable confirmation of what got created (e.g., the URL of the
#      App Runner / Lambda function the web app lives at).
#   2. Programmatic access for scripts and CI (e.g., a deploy script needs
#      the Lambda ARN to update its code).
#
# Currently empty — modules will surface their own outputs through here once
# we start composing them.
# =============================================================================

# -----------------------------------------------------------------------------
# Data layer outputs
# -----------------------------------------------------------------------------

output "users_table_name" {
  description = "DynamoDB table for user profiles."
  value       = module.data.users_table_name
}

output "applications_table_name" {
  description = "DynamoDB table for tracked job applications."
  value       = module.data.applications_table_name
}

output "sync_state_table_name" {
  description = "DynamoDB table for per-user Gmail sync state."
  value       = module.data.sync_state_table_name
}

# -----------------------------------------------------------------------------
# Auth layer outputs
# -----------------------------------------------------------------------------

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID."
  value       = module.auth.user_pool_id
}

output "cognito_client_id" {
  description = "Cognito App Client ID."
  value       = module.auth.client_id
}

output "cognito_domain_full_url" {
  description = "Full hosted UI base URL (https://...amazoncognito.com)."
  value       = module.auth.domain_full_url
}

output "cognito_google_idp_callback_url" {
  description = "URL to register in Google Cloud Console as an Authorized redirect URI on the OAuth client."
  value       = module.auth.google_idp_callback_url
}

output "token_kms_key_alias" {
  description = "KMS alias for the Gmail token encryption key."
  value       = module.auth.token_kms_key_alias
}

output "token_kms_key_arn" {
  description = "KMS key ARN used to encrypt Gmail refresh tokens."
  value       = module.auth.token_kms_key_arn
}

# -----------------------------------------------------------------------------
# Web layer outputs
# -----------------------------------------------------------------------------

output "web_url" {
  description = "Public URL of the deployed web app."
  value       = module.web.cloudfront_url
}

output "web_cloudfront_distribution_id" {
  description = "CloudFront distribution ID. Use for cache invalidations after deploys."
  value       = module.web.cloudfront_distribution_id
}

output "web_assets_bucket" {
  description = "S3 bucket holding the web app's static assets."
  value       = module.web.assets_bucket_name
}

output "web_server_lambda" {
  description = "Server Lambda function name. Use for deploy scripts that update code."
  value       = module.web.server_lambda_name
}
