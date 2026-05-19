# =============================================================================
# outputs.tf — Values exposed to the caller (the dev/prod environment)
# =============================================================================
#
# The web module (Lambda) needs these to validate Cognito JWTs and to
# construct the hosted-UI redirect URL. The environment surfaces a subset
# of these in its own outputs so they show up in `terraform output`.
# =============================================================================

output "user_pool_id" {
  description = "Cognito User Pool ID. Used by the app to construct JWKS URLs for JWT validation."
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN. Useful for IAM policies that grant admin access (we do not yet need it)."
  value       = aws_cognito_user_pool.main.arn
}

output "client_id" {
  description = "Cognito App Client ID. Embedded in the hosted-UI redirect URL and in token-exchange requests."
  value       = aws_cognito_user_pool_client.web.id
}

output "client_secret" {
  description = "Cognito App Client Secret. Required by /api/auth/callback to exchange the OAuth code for tokens."
  value       = aws_cognito_user_pool_client.web.client_secret
  sensitive   = true
}

output "domain" {
  description = "Hosted UI domain prefix (e.g., 'jobtracker-dev')."
  value       = aws_cognito_user_pool_domain.main.domain
}

output "domain_full_url" {
  description = "Full hosted UI base URL (https://...amazoncognito.com)."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

# Convenience output: the full URL a user gets redirected to to start the
# Google sign-in flow. Caller passes the redirect_uri it wants Cognito to
# return to after auth completes (typically the app's /api/auth/callback).
#
# Note: this is informational only; the Next.js app constructs its own
# version of this URL at runtime to add the `state` parameter for CSRF
# protection.
output "hosted_ui_login_url_template" {
  description = "Template for the hosted UI login URL. Caller should append &state=... and &redirect_uri=... at runtime."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.name}.amazoncognito.com/oauth2/authorize?identity_provider=Google&response_type=code&client_id=${aws_cognito_user_pool_client.web.id}&scope=openid+profile+email"
}

# The Google callback URL that must be registered in Google Cloud Console
# as an authorized redirect URI on the OAuth client. Surfacing this as
# an output so it's easy to find and copy-paste.
output "google_idp_callback_url" {
  description = "URL that must be registered in Google Cloud Console → OAuth client → Authorized redirect URIs."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${data.aws_region.current.name}.amazoncognito.com/oauth2/idpresponse"
}

output "token_kms_key_arn" {
  description = "KMS key ARN used by the web app to encrypt Gmail refresh tokens."
  value       = aws_kms_key.tokens.arn
}

output "token_kms_key_alias" {
  description = "KMS alias for the Gmail token encryption key."
  value       = aws_kms_alias.tokens.name
}
