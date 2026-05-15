# =============================================================================
# variables.tf — Inputs to the web module
# =============================================================================
#
# Conventions:
#   - Names that vary per-environment (project, environment) are required.
#   - Anything specific to the OpenNext build output (paths inside the
#     repo) has a default that matches the canonical build location.
#   - Anything callers might rarely override (price class, runtime) is a
#     variable with a default so it can be tuned without editing the module.
# =============================================================================

variable "project" {
  description = "Project name prefix for resource naming (e.g., 'jobtracker')."
  type        = string
}

variable "environment" {
  description = "Environment name (e.g., 'dev', 'prod')."
  type        = string
}

variable "open_next_dir" {
  description = "Absolute or repo-relative path to the OpenNext build output (.open-next/). Must contain server-functions/default/, image-optimization-function/, and assets/."
  type        = string
}

variable "lambda_runtime" {
  description = "Lambda runtime for Node.js. nodejs20.x is the current AWS LTS recommendation; OpenNext supports 18 and 20."
  type        = string
  default     = "nodejs20.x"
}

variable "server_lambda_memory_mb" {
  description = "Memory size for the server SSR Lambda. More memory also gives proportional CPU — 1024 is the sweet spot for Next.js cold-start time vs cost."
  type        = number
  default     = 1024
}

variable "server_lambda_timeout_s" {
  description = "Timeout for the server Lambda. 30s matches CloudFront's default origin timeout. Higher won't help; CloudFront will give up first."
  type        = number
  default     = 30
}

variable "image_lambda_memory_mb" {
  description = "Memory size for the image-optimization Lambda. Image resizing benefits from CPU; 1536 MB gives a noticeable speedup without much extra cost."
  type        = number
  default     = 1536
}

variable "image_lambda_timeout_s" {
  description = "Timeout for the image-optimization Lambda. 25s is generous for resize; most operations finish in 1-2s."
  type        = number
  default     = 25
}

variable "cloudfront_price_class" {
  description = "CloudFront price class. PriceClass_100 covers US, Canada, Europe — cheapest. PriceClass_200 adds Asia, Middle East. PriceClass_All adds Australia, South America."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.cloudfront_price_class)
    error_message = "Must be one of PriceClass_100, PriceClass_200, PriceClass_All."
  }
}

variable "users_table_name" {
  description = "Name of the DynamoDB users table — passed as USERS_TABLE env var to the server Lambda."
  type        = string
}

variable "users_table_arn" {
  description = "ARN of the users DynamoDB table. Used in the Lambda IAM policy."
  type        = string
}

# ---------------------------------------------------------------------------
# Cognito wiring — passed in from the auth module via the environment
# ---------------------------------------------------------------------------
# The server Lambda needs these to validate JWTs and to construct the
# hosted-UI redirect URL. Marked sensitive where applicable so they don't
# show up in plan output.

variable "cognito_user_pool_id" {
  description = "Cognito User Pool ID. Used by the Lambda to fetch the JWKS for JWT signature verification."
  type        = string
}

variable "cognito_client_id" {
  description = "Cognito App Client ID. Embedded in the hosted-UI redirect URL and token-exchange requests."
  type        = string
}

variable "cognito_client_secret" {
  description = "Cognito App Client Secret. Required for the /api/auth/callback token exchange."
  type        = string
  sensitive   = true
}

variable "cognito_domain_full_url" {
  description = "Full hosted-UI base URL (e.g., https://jobtracker-dev.auth.us-east-1.amazoncognito.com)."
  type        = string
}

variable "app_url" {
  description = "Public URL of the deployed app (e.g., the CloudFront URL). Used to construct OAuth callback redirects."
  type        = string
}
