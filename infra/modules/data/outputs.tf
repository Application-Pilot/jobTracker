# =============================================================================
# outputs.tf — Values the dev environment (or any caller) can read
# =============================================================================
#
# Every other module that needs to talk to these tables will read these
# outputs. For example, the future `modules/web` Lambda needs to know:
#
#   - the table names (passed to the app as env vars)
#   - the table ARNs (granted via IAM policy)
#
# Surfacing both ARN and name makes the consuming module's code clearer:
# names go into Lambda environment variables, ARNs go into IAM policies.
# =============================================================================

output "users_table_name" {
  description = "Name of the users DynamoDB table."
  value       = aws_dynamodb_table.users.name
}

output "users_table_arn" {
  description = "ARN of the users DynamoDB table. Used in IAM policies."
  value       = aws_dynamodb_table.users.arn
}

output "applications_table_name" {
  description = "Name of the applications DynamoDB table."
  value       = aws_dynamodb_table.applications.name
}

output "applications_table_arn" {
  description = "ARN of the applications DynamoDB table."
  value       = aws_dynamodb_table.applications.arn
}

output "applications_gsi_name" {
  description = "Name of the GSI on applications used for Gmail thread lookups."
  value       = "by-gmail-thread"
}

output "sync_state_table_name" {
  description = "Name of the sync_state DynamoDB table."
  value       = aws_dynamodb_table.sync_state.name
}

output "sync_state_table_arn" {
  description = "ARN of the sync_state DynamoDB table."
  value       = aws_dynamodb_table.sync_state.arn
}

# Combined list of all table ARNs — convenient for granting a Lambda
# blanket access to "all jobtracker tables" via a single IAM statement.
# Includes "/index/*" so policies covering this list also cover the GSIs.
output "all_table_arns" {
  description = "ARNs of every table created by this module, plus their indexes. Useful for IAM policies that grant blanket access."
  value = [
    aws_dynamodb_table.users.arn,
    "${aws_dynamodb_table.users.arn}/index/*",
    aws_dynamodb_table.applications.arn,
    "${aws_dynamodb_table.applications.arn}/index/*",
    aws_dynamodb_table.sync_state.arn,
    "${aws_dynamodb_table.sync_state.arn}/index/*",
  ]
}
