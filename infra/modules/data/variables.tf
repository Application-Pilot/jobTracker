# =============================================================================
# variables.tf — Inputs to the data module
# =============================================================================
#
# Modules in Terraform are reusable units of infrastructure. This module
# creates DynamoDB tables for the jobtracker app. Inputs are kept minimal —
# everything else is hardcoded as a sensible default inside main.tf because
# making it overridable would just be noise at our scale.
# =============================================================================

variable "project" {
  description = "Project name, used as a prefix in all resource names (e.g., 'jobtracker')."
  type        = string
}

variable "environment" {
  description = "Environment name, used in resource names and tags (e.g., 'dev', 'prod')."
  type        = string
}

variable "point_in_time_recovery" {
  description = "Enable DynamoDB Point-In-Time Recovery (PITR). Adds ~$0.20/GB/month but gives you 35-day rollback against accidental deletes/writes. Worth it always."
  type        = bool
  default     = true
}
