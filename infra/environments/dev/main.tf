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
