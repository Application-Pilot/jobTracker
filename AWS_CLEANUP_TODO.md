# AWS Cleanup + Production Migration TODO

Working doc for the jobtracker prod migration. Reference this back to Claude in any future session.

**AWS Account ID:** `209479264107`
**Currently authenticated as:** root user (will move to IAM user soon)
**Date started:** 2026-05-07

---

## Stage 0 — Account cleanup ✅ COMPLETE (2026-05-07)

Goal: zero billable resources from old experiments before we start fresh.

### What was found and deleted

- [x] EC2 t2.micro `i-03bb88918a9e89ee2` "Daipayan's EC2" in `us-east-2`
- [x] EBS volume (8 GB) — auto-deleted with instance
- [x] Redshift workgroup `default-workgroup` in `us-east-1` (128 RPU)
- [x] Redshift workgroup `redshift-serverless-demo` in `us-east-1` (8 RPU)
- [x] Redshift workgroup `default-workgroup` in `us-west-1` (128 RPU)
- [x] 3 Redshift namespaces (one per workgroup)
- [x] IAM role `Shivani_assignment` + its instance profile + attached policies
- [x] 3 Redshift IAM roles (`AmazonRedshift-CommandsAccessRole-*`)
- [x] 4 customer-managed IAM policies (`s3redshiftpermisson`, 3× `AmazonRedshift-CommandsAccessPolicy-*`)
- [x] Custom VPC `vpc-0cd1bc59a7834a3a8` in us-east-2 + its subnet
- [x] Security group `launch-wizard-1` in us-east-2 (auto-removed when EC2 terminated)

### Final verification ✅

- No EC2 / EBS / Elastic IPs / snapshots in any region
- No Redshift workgroups or namespaces anywhere
- No RDS, Lambda, DynamoDB, S3
- No custom VPCs, no non-default security groups
- No IAM users, customer roles, or customer policies
- Default VPCs intact (per region) — these are AWS-managed and free
- AWS-service-linked roles intact — these are auto-managed and free

### Account hygiene — next up (before Terraform)

- [ ] **Enable MFA on root user** — Console → top-right account → Security credentials → Assign MFA device → use authenticator app
- [ ] **Create IAM user `neil`** with `AdministratorAccess` policy
- [ ] **Sign out of root, sign in as `neil`** for daily work
- [ ] **Generate access keys for `neil`**, run `aws configure` to replace root keys
- [ ] **Delete the root access key** `AKIATBRPP45VZE6EBDEZ` (created 2026-05-07, still active)
- [ ] **Set up Billing budget alert** at $5/month with email notification (Billing → Budgets → Create budget)
- [ ] Bookmark IAM sign-in URL: `https://209479264107.signin.aws.amazon.com/console`

---

## Stage 1 — Foundation (next up)

Goal: repo is restructured, Terraform skeleton is in place, "hello world" Next.js deployed to AWS.

### Folder restructure

Target layout:

```
jobtracker/
├── prototype/      # current code moves here (git mv to preserve history)
├── infra/          # Terraform
├── app/            # new pnpm workspace monorepo
│   ├── apps/
│   │   ├── web/    # Next.js dashboard
│   │   └── workers/# Lambda handlers
│   └── packages/
│       ├── core/
│       ├── llm/
│       ├── gmail/
│       └── db/
├── docs/
│   ├── architecture.png
│   └── decisions/  # ADRs
└── README.md       # resume-facing
```

### Terraform skeleton

- [ ] `infra/bootstrap/` — S3 state bucket + DynamoDB lock table (run once, local state)
- [ ] `infra/environments/dev/` — provider, remote backend, calls modules
- [ ] `infra/environments/prod/` — same shape, prod values
- [ ] `infra/modules/web/` — App Runner / Lambda module (placeholder Next.js)
- [ ] `infra/modules/data/` — DynamoDB tables (users, applications, sync_state)
- [ ] `infra/modules/auth/` — empty stub
- [ ] `infra/modules/sync/` — empty stub
- [ ] `infra/modules/observability/` — empty stub
- [ ] `infra/README.md` — setup, prereqs, cost estimate

### First deploy goal

`terraform apply` in dev produces a real AWS-hosted URL serving a barebones Next.js page that says "Jobtracker — coming soon".

### Decisions locked in

- **Region:** `us-east-1` (cheapest, every service available)
- **State backend:** S3 + DynamoDB lock table, bootstrapped via `infra/bootstrap/`
- **Environment strategy:** separate folders per env (`dev/`, `prod/`), not workspaces
- **Naming:** `jobtracker-{env}-{resource}`
- **Workspace style:** pnpm monorepo (Option A from earlier discussion)
- **IaC tool:** Terraform (not CDK)

---

## Stage 2 — Multi-tenant core (later)

Goal: real students can sign up, connect Gmail, see their applications synced.

- [ ] Cognito user pool + Google IdP (`modules/auth`)
- [ ] Gmail OAuth flow (separate from app login), store encrypted refresh tokens per user
- [ ] EventBridge cron → Lambda scheduler → SQS → Lambda workers → Gemini → DynamoDB (`modules/sync`)
- [ ] `app/packages/llm` — provider-agnostic extractor (port logic from prototype, abstract LLM call)
- [ ] `app/apps/web` — real multi-tenant dashboard, queries DynamoDB by `userId`
- [ ] Per-user data isolation enforced everywhere
- [ ] Test with 2 accounts (you + a friend)

---

## Stage 3 — Production polish (much later)

Goal: confident enough to share with a class group chat.

- [ ] CloudWatch dashboards + alarms (sync failures, cost spike, DLQ depth)
- [ ] DLQ handling + "reconnect Gmail" UX
- [ ] Per-user rate limiting + Gemini quota cap
- [ ] Privacy: delete-my-data flow, encryption verification, privacy policy page
- [ ] Domain + TLS (Route 53 + ACM)
- [ ] `prod` environment with stricter settings
- [ ] README polish, architecture diagram, ADRs in `docs/decisions/`
- [ ] Resume writeup

---

## Open questions / future decisions

- DynamoDB vs RDS Postgres? Currently leaning DynamoDB but revisit if analytics across users matters.
- LLM provider: keep Gemini Flash + add Groq Llama 3.2 3B as fallback for rate limit resilience.
- Hosting layer: App Runner first, revisit Lambda+API Gateway if cost/latency calls for it.

---

## Notes / context

- The prototype currently in repo root will move to `prototype/` (preserve git history with `git mv`).
- Bulk-sync route is local-only and stays as-is in `prototype/`.
- Apps Script flow is deprecated.
- Bill on this account is tiny (~$2.55 month-to-date) and dropping to ~$0 once cleanup finishes.
