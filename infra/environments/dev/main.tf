# =============================================================================
# main.tf — Module composition for the dev environment
# =============================================================================
#
# This file is intentionally short right now. Its job is to *call* modules
# from infra/modules/ and pass them environment-specific inputs.
#
# Currently empty (no modules called) — this is a deliberate first checkpoint
# proving the remote backend works before we add real resources.
#
# Subsequent commits will add module blocks here, e.g.:
#
#   module "data" {
#     source      = "../../modules/data"
#     project     = var.project
#     environment = var.environment
#   }
# =============================================================================

# Locals derive computed values used across module calls below.
# Centralizing name_prefix here keeps "jobtracker-dev-" consistent everywhere.
locals {
  name_prefix = "${var.project}-${var.environment}"
}

# -----------------------------------------------------------------------------
# Data layer — DynamoDB tables (users, applications, sync_state)
# -----------------------------------------------------------------------------
#
# `source = "../../modules/data"` is a local path — Terraform reads the
# module's files directly from disk. This is the simplest way to share
# modules within a repo; other options (Git URL, Terraform Registry) only
# matter when modules are reused across repos.
#
# We pass project/environment in so the module knows what to name resources.
# Everything else uses sensible defaults defined in the module itself.
# -----------------------------------------------------------------------------

module "data" {
  source = "../../modules/data"

  project     = var.project
  environment = var.environment
}

# -----------------------------------------------------------------------------
# Auth layer — Cognito User Pool + Google IdP (see infra/modules/auth/README.md)
# -----------------------------------------------------------------------------
#
# Federated-only: users sign in exclusively via Google. The auth module
# creates the user pool, hosted UI domain, Google IdP wiring, and the
# Cognito client the Next.js app will use.
#
# Google credentials come from terraform.tfvars (gitignored).
# -----------------------------------------------------------------------------

# Locals for callback / logout URLs so they appear in one place.
locals {
  app_url_prod = "https://d2etjfsuqxfql6.cloudfront.net"
  app_url_dev  = "http://localhost:3001"
}

module "auth" {
  source = "../../modules/auth"

  project     = var.project
  environment = var.environment

  google_client_id     = var.google_client_id
  google_client_secret = var.google_client_secret

  callback_urls = [
    "${local.app_url_prod}/api/auth/callback",
    "${local.app_url_dev}/api/auth/callback",
  ]

  logout_urls = [
    "${local.app_url_prod}/signed-out",
    "${local.app_url_dev}/signed-out",
    # Keep the bare-/ entries as fallbacks in case anything links there
    # during development. Removing them later is harmless.
    "${local.app_url_prod}/",
    "${local.app_url_dev}/",
  ]
}

# -----------------------------------------------------------------------------
# Web layer — Lambda + CloudFront + S3 via OpenNext (see docs/decisions/0001-web-hosting.md)
# -----------------------------------------------------------------------------
#
# Consumes the OpenNext build output that lives in app/apps/web/.open-next/.
# You must run `pnpm --filter @jobtracker/web build:lambda` before applying
# this module — Terraform expects those files to exist on disk.
#
# Grants the server Lambda DynamoDB read on the users table only, scoped
# narrowly so a Lambda compromise can't exfiltrate applications data.
# -----------------------------------------------------------------------------

module "web" {
  source = "../../modules/web"

  project       = var.project
  environment   = var.environment
  open_next_dir = "${path.module}/../../../app/apps/web/.open-next"

  users_table_name = module.data.users_table_name
  users_table_arn  = module.data.users_table_arn

  # Cognito wiring — outputs from the auth module above.
  cognito_user_pool_id    = module.auth.user_pool_id
  cognito_client_id       = module.auth.client_id
  cognito_client_secret   = module.auth.client_secret
  cognito_domain_full_url = module.auth.domain_full_url

  app_url = local.app_url_prod
}
