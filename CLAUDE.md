# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this repo is

**jobtracker** — a job application tracker. The repo holds two generations of the project side by side:

- **`prototype/`** — the original single-user Next.js + Google Sheets implementation. Working, deployed, used daily. Code is frozen here as a reference; new work happens in `app/` and `infra/`.
- **`app/`** — the multi-tenant rewrite (Next.js + AWS, in progress).
- **`infra/`** — Terraform for the AWS environment that hosts `app/`.
- **`docs/`** — architecture diagrams and decision records.

## Layout

```
jobtracker/
├── prototype/          # Original single-user app — see prototype/CLAUDE.md
├── app/                # New multi-tenant app (pnpm workspace monorepo)
├── infra/              # Terraform for AWS
├── docs/               # Diagrams, ADRs, architecture writeups
├── AWS_CLEANUP_TODO.md # Migration plan / progress tracker
└── README.md
```

When working inside `prototype/`, follow `prototype/CLAUDE.md` — that file describes the legacy stack (Google Sheets, Apps Script, Cloud Run sync) and its constraints. Do not port `prototype/` conventions into `app/` blindly; the new app is multi-tenant and runs on different infra.

## Active migration

The project is partway through Stage 1 of a three-stage migration to AWS. See [AWS_CLEANUP_TODO.md](AWS_CLEANUP_TODO.md) for the running checklist and stage definitions.

Stage status:
- **Stage 0 (cleanup):** complete
- **Stage 1 (foundation):** in progress — folder restructure done, Terraform bootstrap next
- **Stage 2 (multi-tenant core):** not started
- **Stage 3 (production polish):** not started

## AWS context

- Account ID: `209479264107`
- Default region: `us-east-1`
- IAM user for daily work and CLI: `neil` with `AdministratorAccess`
- Root account: MFA-protected (iCloud Keychain passkey), no active access keys

## Working principles for this repo

1. **Never modify `prototype/` to match new patterns** — it's legacy and stays as-is unless there's a real bug.
2. **Terraform changes go through `terraform plan` review** before apply, every time.
3. **Secrets stay out of git.** `cred.json`, `.env*`, and any `*service-account*.json` are gitignored at the root.
4. **The bill must stay near zero** until real users exist. Verify cost implications of any new AWS resource before applying.
