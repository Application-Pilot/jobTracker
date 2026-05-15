# =============================================================================
# main.tf — Cognito User Pool + Google IdP for jobtracker auth
# =============================================================================
#
# This module sets up federated-only authentication: users sign in
# exclusively via Google. There is no password support. The pieces:
#
#   1. aws_cognito_user_pool          — the user database
#   2. aws_cognito_user_pool_domain   — the hosted-UI domain
#                                       (https://jobtracker-dev.auth.us-east-1.amazoncognito.com)
#   3. aws_cognito_identity_provider  — Google wired in as an IdP
#   4. aws_cognito_user_pool_client   — the OAuth "client" that the
#                                       Next.js app uses to talk to Cognito
#
# Flow (high-level):
#
#   browser
#     │  click "Sign in with Google"
#     ▼
#   app /api/auth/login → redirects to Cognito hosted UI
#     │
#     ▼
#   Cognito hosted UI → redirects to Google
#     │  (Google asks user for consent)
#     ▼
#   Google → POSTs back to Cognito at /oauth2/idpresponse
#     │
#     ▼
#   Cognito → redirects to app at /api/auth/callback?code=...
#     │
#     ▼
#   app exchanges code for tokens, sets httpOnly session cookie
#
# =============================================================================

locals {
  name_prefix = "${var.project}-${var.environment}"

  # The hosted-UI domain prefix must be globally unique within Cognito for
  # the region. The full URL becomes:
  #   https://{prefix}.auth.{region}.amazoncognito.com
  hosted_ui_domain_prefix = "${var.project}-${var.environment}"
}

# Discover the current region for output construction (we use it in the
# hosted_ui_login_url output below).
data "aws_region" "current" {}

# -----------------------------------------------------------------------------
# User Pool — the database of users
# -----------------------------------------------------------------------------
#
# Because we are federated-only, several Cognito features are intentionally
# DISABLED:
#
#   - MFA: not applicable (Google handles MFA on its side)
#   - Account recovery: nothing to recover (no Cognito-managed passwords)
#   - Auto-verify attributes: Google's email is implicitly verified
#   - Password policy: irrelevant
#
# What we DO configure:
#   - username_attributes = ["email"] — users are identified by email
#   - Standard "email" attribute (read from Google's id_token)
#   - deletion_protection: prevents accidental destroy of the pool
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool" "main" {
  name = "${local.name_prefix}-users"

  # Users are identified by email. Cognito normalizes email to lowercase
  # internally, so "Neil@example.com" and "neil@example.com" are the same.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Standard attributes we want available on every user. Email is implicit
  # but we declare it for clarity. name comes from Google.
  schema {
    name                = "email"
    attribute_data_type = "String"
    required            = true
    mutable             = true

    string_attribute_constraints {
      min_length = 5
      max_length = 256
    }
  }

  schema {
    name                = "name"
    attribute_data_type = "String"
    required            = false
    mutable             = true

    string_attribute_constraints {
      min_length = 1
      max_length = 256
    }
  }

  # No MFA. Google handles it.
  mfa_configuration = "OFF"

  # Account recovery: irrelevant for federated-only. Set to "verified_email"
  # as a defensive default in case we ever enable Cognito-managed passwords.
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Prevents `terraform destroy` from blasting the entire user pool by
  # accident. To delete, set to "INACTIVE" in code, apply, then destroy.
  deletion_protection = "ACTIVE"

  tags = {
    Name      = "${local.name_prefix}-users"
    Component = "auth"
  }
}

# -----------------------------------------------------------------------------
# Hosted UI Domain
# -----------------------------------------------------------------------------
#
# Cognito provides a hosted login UI at:
#   https://{prefix}.auth.{region}.amazoncognito.com
#
# This is where users get redirected for "Sign in with Google". Free; AWS
# branding only (we can add a logo + colors via aws_cognito_user_pool_ui_customization
# later in Stage 3).
#
# The domain prefix must be globally unique within Cognito for the region.
# "jobtracker-dev" is specific enough that conflicts are unlikely.
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool_domain" "main" {
  domain       = local.hosted_ui_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

# -----------------------------------------------------------------------------
# Google Identity Provider
# -----------------------------------------------------------------------------
#
# Wires Google into the user pool as an IdP. When the user clicks
# "Continue with Google" in Cognito's hosted UI, Cognito redirects to:
#   https://accounts.google.com/o/oauth2/v2/auth?client_id={google_client_id}&...
#
# After the user consents, Google calls back to:
#   https://jobtracker-dev.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
# (that URL must be registered in Google Cloud Console as an "Authorized
# redirect URI" on the OAuth client.)
#
# attribute_mapping tells Cognito which Google claims become which
# Cognito attributes. We map:
#   - email → email (used as username)
#   - name → name
#   - sub → username (Cognito's internal unique ID — sourced from Google's sub)
# -----------------------------------------------------------------------------

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid profile email"
  }

  attribute_mapping = {
    email    = "email"
    name     = "name"
    username = "sub"
  }
}

# -----------------------------------------------------------------------------
# User Pool Client
# -----------------------------------------------------------------------------
#
# A "client" in Cognito terms is the app that talks to the user pool.
# Each environment has its own client (so revoking dev access doesn't
# touch prod). For us, the client = the Next.js app.
#
# Configuration:
#   - generate_secret = true: yes — server-side flows (which we use) require it
#   - allowed_oauth_flows = ["code"]: Authorization Code flow with PKCE.
#     Implicit flow is deprecated.
#   - allowed_oauth_scopes: openid (required), profile, email
#   - supported_identity_providers = ["Google"]: NOT including "COGNITO"
#     means username/password sign-in is disabled. Federated-only.
#   - callback_urls / logout_urls: where Cognito will redirect after auth/signout.
#   - access_token_validity / id_token_validity: short-lived tokens (1 hour),
#     refresh_token_validity: longer-lived (30 days) — refresh on each request.
#
# CRITICAL: depends_on prevents a race. Without it, Terraform sometimes
# creates the client before the IdP exists, fails the
# supported_identity_providers validation, and the apply has to be retried.
# -----------------------------------------------------------------------------

resource "aws_cognito_user_pool_client" "web" {
  name         = "${local.name_prefix}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  # Required for the server-side token exchange in /api/auth/callback.
  generate_secret = true

  # OAuth 2.0 Authorization Code Grant flow.
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "profile", "email"]

  # Federated-only: Google is the ONLY way to sign in. No username/password.
  supported_identity_providers = ["Google"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  # Token lifetimes. id/access tokens are short-lived — the app should
  # never trust an id_token older than this. The refresh_token is the
  # long-lived credential (the cookie holds it after wrapping).
  access_token_validity  = 60       # minutes
  id_token_validity      = 60       # minutes
  refresh_token_validity = 30       # days
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  # Auth flows allowed on the API (not the hosted UI). USER_SRP and
  # REFRESH_TOKEN cover server-side refresh; admin flows are off.
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  # Prevent_user_existence_errors: when a user enters a non-existent email,
  # Cognito returns a generic error instead of "user doesn't exist". This is
  # a defense against email enumeration attacks. ENABLED is the recommended
  # default.
  prevent_user_existence_errors = "ENABLED"

  # CRITICAL — without this, Terraform can try to create this resource
  # before the Google IdP exists, then fail with:
  #   "InvalidParameterException: ... supportedIdentityProviders ... Google ... not found"
  depends_on = [aws_cognito_identity_provider.google]
}
