# jobtracker

A job application tracker, evolving from a single-user prototype to a multi-tenant SaaS.

## Repo layout

| Path | What it is |
|---|---|
| [`prototype/`](prototype/) | The original single-user app — Next.js + Google Sheets + Apps Script + Gemini parsing. Deployed to Cloud Run, used daily. |
| [`app/`](app/) | The multi-tenant rewrite — Next.js + AWS (Cognito, DynamoDB, Lambda, SQS). In progress. |
| [`infra/`](infra/) | Terraform for the AWS environment that hosts `app/`. |
| [`docs/`](docs/) | Architecture diagrams and decision records (ADRs). |
| [`AWS_CLEANUP_TODO.md`](AWS_CLEANUP_TODO.md) | Migration plan and stage tracker. |

## Status

- **Stage 0 — Account cleanup:** ✅ complete
- **Stage 1 — Foundation (folder restructure + Terraform bootstrap):** in progress
- **Stage 2 — Multi-tenant core:** not started
- **Stage 3 — Production polish:** not started

See [`AWS_CLEANUP_TODO.md`](AWS_CLEANUP_TODO.md) for the running checklist.

## Why two codebases in one repo?

The prototype works and shouldn't be discarded — it's the proof of concept and the reference behaviour. The rewrite needs to ship without breaking the prototype. Keeping them side by side makes the evolution legible and the migration reversible.
