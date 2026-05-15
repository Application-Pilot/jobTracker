# =============================================================================
# variables.tf — Inputs to the auth module
# =============================================================================
#
# The auth module creates a Cognito User Pool federated against Google as
# the only identity provider. The Google client credentials are inputs
# because they live outside Terraform (they're created by hand in the
# Google Cloud Console) and must NEVER appear in version control.
#
# Callbacks are an input because they're environment-specific: dev uses
# both the CloudFront URL and localhost; prod would use only the real
# domain.
# =============================================================================

variable "project" {
  description = "Project name prefix used in resource naming (e.g., 'jobtracker')."
  type        = string
}

variable "environment" {
  description = "Environment name (e.g., 'dev', 'prod'). Used in resource names and tags."
  type        = string
}

variable "google_client_id" {
  description = "Google OAuth 2.0 Client ID. Created in Google Cloud Console → APIs & Services → Credentials."
  type        = string
  sensitive   = true # Not actually secret (the client_id is sent to browsers), but flagging it sensitive keeps it out of plan output.
}

variable "google_client_secret" {
  description = "Google OAuth 2.0 Client Secret. Truly secret — never log, never commit."
  type        = string
  sensitive   = true
}

variable "callback_urls" {
  description = "Allowed callback URLs after Cognito completes auth. Must match the URLs Cognito redirects back to your app."
  type        = list(string)

  validation {
    condition     = length(var.callback_urls) > 0
    error_message = "callback_urls must have at least one entry."
  }
}

variable "logout_urls" {
  description = "Allowed logout redirect URLs. Cognito will only redirect to URLs in this list after sign-out."
  type        = list(string)

  validation {
    condition     = length(var.logout_urls) > 0
    error_message = "logout_urls must have at least one entry."
  }
}
