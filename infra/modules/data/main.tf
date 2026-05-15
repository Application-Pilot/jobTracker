# =============================================================================
# main.tf — DynamoDB tables for the jobtracker app
# =============================================================================
#
# We use three tables, one per top-level entity. This is sometimes called
# "multi-table design" and is the more readable choice — every entity has
# its own clearly-named table. The DynamoDB community generally advocates
# "single-table design" (one table for everything, with GSIs for different
# access patterns) for production-scale workloads, but it's harder to design
# upfront and harder to evolve. We can migrate later if access patterns
# justify it. For an MVP, multi-table is the right call.
#
# All three tables share the same configuration philosophy:
#
#   - PAY_PER_REQUEST billing (also called "on-demand"): you pay only for
#     reads/writes you actually do. No need to estimate capacity. Slightly
#     more expensive per request than provisioned at scale, but $0 at idle
#     and zero ops overhead.
#
#   - Point-in-Time Recovery (PITR) ON: 35-day continuous backup, ~$0.20/GB
#     per month. At our data size (<1 GB), this costs pennies. Worth every
#     penny — protects against `terraform destroy` accidents and bad code
#     deleting rows.
#
#   - DeletionProtectionEnabled: prevents `terraform destroy` (or a console
#     click) from accidentally wiping the table. To delete, set this to
#     false in code and apply *first*, then destroy.
#
# Cost reality at 500 users with moderate activity: under $1/month total.
#
# DEPRECATION NOTE (2026-05): AWS provider 6.x has begun deprecating the
# top-level `hash_key` / `range_key` arguments in favor of a `key_schema`
# block ("hash_key is deprecated. Use key_schema instead"). However, the
# `key_schema` block is not yet available at the top-level resource in
# provider 6.44 — only inside `global_secondary_index`. Migrating now
# would either fail validation or force table recreation (data loss).
#
# We are intentionally leaving `hash_key` / `range_key` in place until the
# provider fully supports `key_schema` at the resource level (expected in
# a later 6.x release). Tracking: re-evaluate when bumping the provider.
# =============================================================================

# Locals derive consistent names so we don't repeat string interpolation.
locals {
  name_prefix = "${var.project}-${var.environment}"
}

# -----------------------------------------------------------------------------
# Table: users
# -----------------------------------------------------------------------------
#
# Stores one row per signed-up student.
#
# Primary key: userId (the Cognito sub claim, a UUID string)
#
# Why partition by userId alone (no sort key)?
#   - The dominant access pattern is "get this user's profile" — a single
#     lookup by userId. No need to range over multiple items per user.
#
# Sample row shape (no schema enforcement — DynamoDB is schemaless):
#   {
#     userId:               "abc-123-uuid",         // PK
#     email:                "neil@example.com",
#     name:                 "Neil",
#     gmailRefreshToken:    "<KMS-encrypted blob>", // never store plaintext
#     gmailScopesGranted:   ["gmail.readonly"],
#     createdAt:            "2026-05-12T10:00:00Z",
#     lastLoginAt:          "2026-05-12T10:00:00Z"
#   }
# -----------------------------------------------------------------------------

resource "aws_dynamodb_table" "users" {
  name         = "${local.name_prefix}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  # attribute blocks declare *only* the attributes used in keys or indexes.
  # All other attributes (email, name, etc.) are written at runtime without
  # declaration — DynamoDB is schemaless except for keys.
  attribute {
    name = "userId"
    type = "S" # S = String, N = Number, B = Binary
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  # Prevents accidental table deletion. To delete on purpose, set false, apply,
  # then destroy in two separate steps. Loud and intentional, by design.
  deletion_protection_enabled = true

  # Server-side encryption with an AWS-managed key. Free. The alternative
  # (customer-managed KMS key) costs $1/month per key and we don't need the
  # extra control yet — when we store sensitive data (Gmail tokens), we'll
  # encrypt those fields with their own KMS key at the application layer.
  server_side_encryption {
    enabled = true
  }

  tags = {
    Name      = "${local.name_prefix}-users"
    Component = "data"
  }
}

# -----------------------------------------------------------------------------
# Table: applications
# -----------------------------------------------------------------------------
#
# Stores one row per job application a student has tracked.
#
# Primary key: composite of (userId, applicationId)
#   - hash_key  = userId        partition key, groups all of a user's apps
#   - range_key = applicationId sort key, uniquely identifies an app within a user
#
# Why this shape?
#   - The dominant access pattern is "list all applications for user X"
#     (the dashboard). With this PK, that's a single Query operation reading
#     contiguous items — fast and cheap.
#   - "Get one specific application" is a GetItem with both keys — also cheap.
#
# Global Secondary Index: by-gmail-thread
#   - Lets us look up an application by its Gmail thread ID. Used during
#     sync to check "did I already create an application for this email?"
#     without scanning every row.
#   - Projection: KEYS_ONLY — we only need the PK back so we can fetch the
#     real row. KEYS_ONLY is the cheapest projection (least data copied
#     into the index).
#
# Sample row shape:
#   {
#     userId:           "abc-123-uuid",    // PK
#     applicationId:    "app-xyz-uuid",    // SK
#     gmailThreadId:    "thread-abc",      // indexed via GSI
#     company:          "Stripe",
#     role:             "SWE Intern",
#     status:           "applied",         // applied | interview | offer | rejected
#     appliedAt:        "2026-05-01",
#     emailSubject:     "Application received - SWE Intern at Stripe",
#     emailDate:        "2026-05-01T14:23:00Z",
#     llmExtraction:    { confidence: 0.9, model: "gemini-flash-1.5" },
#     createdAt:        "2026-05-01T14:25:00Z",
#     updatedAt:        "2026-05-01T14:25:00Z"
#   }
# -----------------------------------------------------------------------------

resource "aws_dynamodb_table" "applications" {
  name         = "${local.name_prefix}-applications"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "applicationId"

  attribute {
    name = "userId"
    type = "S"
  }

  attribute {
    name = "applicationId"
    type = "S"
  }

  # Declared here because the GSI below uses it as its partition key.
  attribute {
    name = "gmailThreadId"
    type = "S"
  }

  # Global Secondary Index for dedup lookups by Gmail thread.
  # Without this index, "have I seen this thread before?" would require a
  # full table scan — O(n) and pricey. With it, it's O(1).
  global_secondary_index {
    name            = "by-gmail-thread"
    hash_key        = "gmailThreadId"
    projection_type = "KEYS_ONLY"
    # No read/write capacity needed because parent table is PAY_PER_REQUEST;
    # the index inherits that billing mode automatically.
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  deletion_protection_enabled = true

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name      = "${local.name_prefix}-applications"
    Component = "data"
  }
}

# -----------------------------------------------------------------------------
# Table: sync_state
# -----------------------------------------------------------------------------
#
# One row per user, tracking the state of their last Gmail sync. Used by
# the Lambda sync worker to know where to resume.
#
# Primary key: userId
#
# Sample row shape:
#   {
#     userId:              "abc-123-uuid",   // PK
#     lastSyncAt:          "2026-05-12T10:00:00Z",
#     gmailHistoryId:      "12345",          // Gmail's API cursor for incremental fetches
#     lastSyncStatus:      "success",        // success | failure | partial
#     lastError:           null,
#     nextSyncEligibleAt:  "2026-05-12T10:15:00Z",  // rate-limit gate
#     emailsProcessed:     142,
#     applicationsCreated: 8
#   }
#
# Why a separate table from `users`?
#   - users is mostly stable (profile data, rare writes)
#   - sync_state is high-churn (every 15 min per active user, lots of writes)
#   - Separating them keeps the users table small and read-optimized, and
#     prevents sync churn from inflating users' read costs.
# -----------------------------------------------------------------------------

resource "aws_dynamodb_table" "sync_state" {
  name         = "${local.name_prefix}-sync-state"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  deletion_protection_enabled = true

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name      = "${local.name_prefix}-sync-state"
    Component = "data"
  }
}
