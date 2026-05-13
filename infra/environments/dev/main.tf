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

  project          = var.project
  environment      = var.environment
  open_next_dir    = "${path.module}/../../../app/apps/web/.open-next"

  users_table_name = module.data.users_table_name
  users_table_arn  = module.data.users_table_arn
}
