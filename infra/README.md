# infra/

Terraform configuration for the jobtracker AWS environment.

**Status:** scaffolding only — no resources defined yet. The Terraform bootstrap (S3 state bucket + DynamoDB lock table) lands in the next commit.

## Planned layout

```
infra/
├── bootstrap/            # One-time setup: S3 state bucket + DynamoDB lock table
├── environments/
│   ├── dev/              # dev environment, calls modules with dev-tier settings
│   └── prod/             # prod environment, same shape with stricter values
└── modules/              # Reusable building blocks
    ├── data/             # DynamoDB tables (users, applications, sync_state)
    ├── auth/             # Cognito + Google IdP
    ├── web/              # Next.js hosting (App Runner or Lambda)
    ├── sync/             # EventBridge cron → SQS → Lambda workers
    └── observability/    # CloudWatch dashboards + alarms
```

## Conventions

- **Region:** `us-east-1` for everything by default.
- **Naming:** `jobtracker-{env}-{resource}` (e.g., `jobtracker-dev-applications`).
- **State:** remote state in S3 with DynamoDB locking; bootstrap creates these.
- **Environments:** separate folders, not workspaces — applies are explicit per env.
- **Tagging:** every resource tagged `Project=jobtracker`, `Environment={dev|prod}`, `ManagedBy=terraform`.
