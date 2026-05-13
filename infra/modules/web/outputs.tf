# =============================================================================
# outputs.tf — Web module outputs
# =============================================================================

output "cloudfront_url" {
  description = "Public URL of the deployed web app (CloudFront distribution)."
  value       = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID. Used for cache invalidation after deploys."
  value       = aws_cloudfront_distribution.web.id
}

output "assets_bucket_name" {
  description = "S3 bucket holding static assets."
  value       = aws_s3_bucket.assets.id
}

output "server_lambda_name" {
  description = "Name of the SSR Lambda function. Used for deployment scripts that need to update its code."
  value       = aws_lambda_function.server.function_name
}

output "image_lambda_name" {
  description = "Name of the image-optimization Lambda function."
  value       = aws_lambda_function.image.function_name
}
