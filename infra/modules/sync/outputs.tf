# =============================================================================
# outputs.tf — Values exposed by the sync pipeline module
# =============================================================================

output "jobs_queue_url" {
  description = "URL of the SQS queue that carries per-user sync jobs."
  value       = aws_sqs_queue.jobs.url
}

output "jobs_queue_arn" {
  description = "ARN of the SQS queue that carries per-user sync jobs."
  value       = aws_sqs_queue.jobs.arn
}

output "dlq_url" {
  description = "URL of the SQS dead-letter queue for failed sync jobs."
  value       = aws_sqs_queue.dlq.url
}

output "dlq_arn" {
  description = "ARN of the SQS dead-letter queue for failed sync jobs."
  value       = aws_sqs_queue.dlq.arn
}

output "scheduler_function_name" {
  description = "Name of the EventBridge-triggered scheduler Lambda."
  value       = aws_lambda_function.scheduler.function_name
}

output "worker_function_name" {
  description = "Name of the SQS-triggered sync worker Lambda."
  value       = aws_lambda_function.worker.function_name
}
