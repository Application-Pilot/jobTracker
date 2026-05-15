# =============================================================================
# variables.tf — Inputs to the dev environment
# =============================================================================
#
# Convention: this environment exposes a small set of variables with sensible
# defaults so `terraform apply` works without a tfvars file. If you want to
# override a default (e.g., trying a different region), create a
# terraform.tfvars file — that file is gitignored.
# =============================================================================

variable "region" {
  description = "AWS region for all resources in this environment."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name. Used in resource naming and tags."
  type        = string
  default     = "dev"

  # Defensive validation — if someone overrides this with "production" or
  # a typo like "deb", the plan rejects it immediately instead of creating
  # mis-named resources.
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be 'dev' or 'prod'."
  }
}

variable "project" {
  description = "Project name prefix for resource naming."
  type        = string
  default     = "jobtracker"
}

# ---------------------------------------------------------------------------
# Auth module inputs — Google OAuth credentials
# ---------------------------------------------------------------------------
# These come from `terraform.tfvars` (gitignored). See `terraform.tfvars.example`
# for the shape. Both are marked sensitive so they never appear in plan output
# or in the `terraform output` JSON.
# ---------------------------------------------------------------------------

variable "google_client_id" {
  description = "Google OAuth 2.0 Client ID for the Cognito Google IdP. Created in Google Cloud Console."
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth 2.0 Client Secret. Required by Cognito to redeem auth codes from Google."
  type        = string
  sensitive   = true
}
