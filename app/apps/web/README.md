# @jobtracker/web

The multi-tenant Next.js dashboard for jobtracker.

**Status:** placeholder. One page, server-rendered, reads from DynamoDB to prove end-to-end connectivity once deployed.

## Local dev

```bash
pnpm install                 # from repo root: app/
pnpm --filter @jobtracker/web dev
# or from this directory:
pnpm dev                     # http://localhost:3001
```

Without AWS credentials configured locally, the user-count card on the home page shows "DB connection: not configured". That's expected — the app still renders.

To exercise the DB locally:

```bash
export AWS_REGION=us-east-1
export USERS_TABLE=jobtracker-dev-users
pnpm dev
```

(Assumes `aws sts get-caller-identity` works locally — the AWS SDK picks up credentials from the same chain as the CLI.)

## Production build

```bash
pnpm build              # next build (standard Next.js production build)
pnpm build:lambda       # open-next build (transforms output for Lambda)
```

The OpenNext build produces `.open-next/` containing four directories:

- `server-function/` — the Next.js SSR handler, becomes Lambda #1
- `image-optimization-function/` — image optimizer, becomes Lambda #2
- `assets/` — static files, uploaded to S3
- `cache/` — (unused for our placeholder; relevant when ISR is on)

The Terraform module in `infra/modules/web/` consumes these directories.

## Why "force-dynamic" on the home page?

Server Components are statically rendered at build time by default. We want the user count to reflect *current* DynamoDB state, not the count at build time, so `app/page.tsx` opts into dynamic rendering with `export const dynamic = 'force-dynamic'`. In Stage 2 when we add authenticated user views, the same pattern continues.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `AWS_REGION` | yes (in Lambda) | Defaults to `us-east-1` locally |
| `USERS_TABLE` | yes | Name of the users DynamoDB table to read counts from |

In Lambda these are injected by Terraform (see `infra/modules/web/`). Locally, set them yourself if you want to hit the real DB.
