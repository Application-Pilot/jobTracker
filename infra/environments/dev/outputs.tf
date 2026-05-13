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
