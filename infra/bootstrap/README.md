# bootstrap/

One-time setup that creates the Terraform remote state backend.

**You only run this once for the lifetime of the AWS account.** After it succeeds, every other Terraform module (in `infra/environments/dev/`, `infra/environments/prod/`, etc.) uses the S3 + DynamoDB resources this creates as its remote backend.

## What it creates

| Resource | Name (default) | Purpose |
|---|---|---|
| S3 bucket | `jobtracker-tfstate-209479264107` | Holds `*.tfstate` files. Versioning on, AES256 encryption, public access fully blocked, 90-day cleanup of old non-current versions. |
| DynamoDB table | `jobtracker-tfstate-locks` | Coordinates `terraform apply` so two processes can't write state at the same time. Pay-per-request — costs ~$0 at this volume. |

## State for this module

This module **uses local state** (a `terraform.tfstate` file in this directory) — it can't use the very backend it's creating. The state file is gitignored.

If you ever lose the local state, you can re-import:

```bash
terraform import aws_s3_bucket.tfstate jobtracker-tfstate-209479264107
terraform import aws_dynamodb_table.tfstate_locks jobtracker-tfstate-locks
```

## How to run it

Prereqs:
- Terraform >= 1.6
- AWS CLI configured as IAM user `neil` with admin permissions (verify with `aws sts get-caller-identity`)

```bash
cd infra/bootstrap
terraform init
terraform plan        # review carefully before applying
terraform apply       # confirm 'yes' when prompted
```

After apply, take note of the outputs:

```text
state_bucket_name = "jobtracker-tfstate-209479264107"
lock_table_name   = "jobtracker-tfstate-locks"
region            = "us-east-1"
```

These values get pasted into every environment's `providers.tf` `backend "s3"` block.

## Cost

S3 versioning + a few KB of state + a near-empty DynamoDB table = under $0.05/month. Practically free.

## Don't do these things

- Don't delete the S3 bucket once any environment has state in it — you'll lose the source of truth for everything Terraform manages.
- Don't disable bucket versioning — versions are how you recover from a corrupted apply.
- Don't make the bucket public, ever. State files contain resource metadata and sometimes secrets.
