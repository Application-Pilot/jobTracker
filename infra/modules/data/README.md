# modules/data

DynamoDB tables for the jobtracker app.

## Tables

| Table | PK | SK | Indexes | Purpose |
|---|---|---|---|---|
| `{project}-{env}-users` | `userId` | — | — | One row per signed-up user |
| `{project}-{env}-applications` | `userId` | `applicationId` | GSI `by-gmail-thread` (HASH=`gmailThreadId`) | One row per tracked application |
| `{project}-{env}-sync-state` | `userId` | — | — | Per-user sync cursor + error state |

All three:

- Billing mode: **PAY_PER_REQUEST** (on-demand, $0 idle)
- Point-in-time recovery: **enabled** (35-day rollback window)
- Deletion protection: **enabled** (must be turned off in code before destroy)
- Server-side encryption: **AWS-managed key** (free)

## Usage

```hcl
module "data" {
  source      = "../../modules/data"
  project     = "jobtracker"
  environment = "dev"
}
```

Then consumers can read outputs:

```hcl
# In a Lambda module:
environment_variables = {
  USERS_TABLE        = module.data.users_table_name
  APPLICATIONS_TABLE = module.data.applications_table_name
  SYNC_STATE_TABLE   = module.data.sync_state_table_name
}

# In an IAM policy:
resources = module.data.all_table_arns
```

## Cost expectation

At 500 active users syncing every 15 minutes:

- Writes: ~50k/day across all tables = ~$0.06/day
- Reads: ~200k/day (dashboard loads + dedup checks) = ~$0.05/day
- PITR storage: <$0.20/month (tiny dataset)
- **Total: well under $5/month**

At idle: $0.

## Schema notes for callers (the app, not Terraform)

DynamoDB is schemaless except for keys. The module declares only key
attributes; the application is free to write any other fields. Suggested
shapes are documented in `main.tf` comments — keep them in sync with
the TypeScript type definitions in `app/packages/db/`.

## Why deletion protection?

`deletion_protection_enabled = true` blocks `terraform destroy` and
console-driven deletes from removing the tables. To intentionally delete:

1. Set `deletion_protection_enabled = false` in `main.tf`
2. `terraform apply` (one-line change applied)
3. `terraform destroy` (the actual deletion)

Two steps on purpose — no single typo can wipe out user data.
