# =============================================================================
# providers.tf — AWS provider configuration + remote state backend
# =============================================================================
#
# This file does two things:
#
#   1. Declares which Terraform version + AWS provider version are required.
#      This pins versions so the same `terraform apply` produces the same
#      result on any laptop, today or a year from now.
#
#   2. Configures the S3 backend so Terraform stores its state file in the
#      bucket the bootstrap module created (jobtracker-tfstate-209479264107)
#      and uses the DynamoDB lock table (jobtracker-tfstate-locks) to prevent
#      two `terraform apply` runs from clobbering each other.
#
# Without a remote backend, state lives in a local terraform.tfstate file —
# which is unsafe (a lost laptop = lost knowledge of what's deployed) and
# breaks any team workflow (no way to share state). Remote backend = day-one
# professional practice.
# =============================================================================

terraform {
  # Minimum Terraform CLI version. Below 1.6 some of the newer S3 backend
  # features (use_lockfile, native locking) behave differently.
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # AWS added an invoked_via_function_url permission flag for Lambda
      # Function URLs after the provider 5.x line. The lock file records the
      # exact version resolved by terraform init.
      version = ">= 6.44, < 7.0"
    }
    # The archive provider zips files on disk (used by modules/web to
    # package Lambda code into the .zip that aws_lambda_function uploads).
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
    # The random provider generates the SESSION_SECRET used by the web
    # Lambda to wrap session cookies. State-stored; never regenerated
    # unless explicitly tainted.
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # ---------------------------------------------------------------------------
  # Remote state backend — S3 + DynamoDB locking.
  # ---------------------------------------------------------------------------
  # Values here MUST match the resources the bootstrap module created.
  # If you ever rotate the bucket or table, update this block and run
  # `terraform init -reconfigure`.
  backend "s3" {
    bucket = "jobtracker-tfstate-209479264107"

    # The "key" is the path inside the bucket. We namespace by environment
    # so dev/prod don't collide:
    #   s3://jobtracker-tfstate-209479264107/environments/dev/terraform.tfstate
    key = "environments/dev/terraform.tfstate"

    region = "us-east-1"

    # DynamoDB table for state locking. While a `terraform apply` is running,
    # it writes a row to this table; concurrent runs see the lock and bail
    # out instead of corrupting state.
    dynamodb_table = "jobtracker-tfstate-locks"

    # Encrypt the state file at rest in S3. Bucket already enforces this
    # via aws_s3_bucket_server_side_encryption_configuration, but setting
    # it here too is belt-and-suspenders and harmless.
    encrypt = true
  }
}

# =============================================================================
# AWS provider — applies to every resource in this environment
# =============================================================================

provider "aws" {
  region = var.region

  # default_tags adds these tags to every taggable AWS resource Terraform
  # creates under this provider. Saves repeating them per resource and
  # guarantees consistency. Three tags worth justifying:
  #
  #   Project     — lets us filter "everything that belongs to jobtracker"
  #                 in the Billing console and Cost Explorer.
  #   Environment — distinguishes dev from prod resources when they share
  #                 an account (which they do here).
  #   ManagedBy   — flags that this resource is Terraformed; if someone
  #                 manually edits it in the console, they know it'll get
  #                 overwritten on the next apply.
  default_tags {
    tags = {
      Project     = "jobtracker"
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}
