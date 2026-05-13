# ADR-0001: Web tier hosts on Lambda + CloudFront via OpenNext

**Status:** accepted
**Date:** 2026-05-12

## Context

The jobtracker rewrite needs a Next.js web app deployed on AWS. We considered four hosting options:

| Option | Cost (idle) | Setup complexity | AWS-native | Resume signal |
|---|---|---|---|---|
| App Runner | ~$5/mo | Low (~120 LOC of Terraform) | Yes | Medium |
| **Lambda + OpenNext + CloudFront** | $0 | High (~400 LOC of Terraform) | Yes | **Strongest** |
| AWS Amplify Hosting | $0 (12mo), then ~pennies | Very low (~30 LOC, shallow) | Yes | Weak (hidden) |
| Vercel | $0 | None | No | Weak (not AWS) |

Three constraints shaped the decision:

1. **Cost-sensitive.** Project is for a CS student, not a funded startup. Any monthly floor we don't strictly need is one we shouldn't pay.
2. **Resume-first.** The infra is the artifact. Whatever we choose has to be defensible in an interview as a meaningful AWS configuration, not a managed click-deploy.
3. **All-Terraform.** Splitting infra between Terraform and a console-managed service muddies the IaC story. Whatever we pick must be fully Terraformable.

## Decision

**Use AWS Lambda + Lambda Function URLs + CloudFront + S3 (assets) via the OpenNext build adapter.**

Specifically:

- **OpenNext** (`@opennextjs/aws`) transforms the Next.js build output into Lambda-shaped artifacts: `server-function/`, `image-optimization-function/`, `assets/`, `cache/`.
- **Two Lambdas:** one server-side renderer (pages + API routes), one image optimizer (`/_next/image`).
- **S3 bucket** holds static assets (`/_next/static/*`, public files), accessed via CloudFront with Origin Access Control (OAC).
- **CloudFront distribution** sits in front of everything, routing requests to Lambda or S3 based on URL pattern.
- **DynamoDB-backed cache** for ISR (incremental static regeneration) — optional, deferred to a later iteration.

## Consequences

### Positive

- **$0 idle cost.** Lambda's free tier covers ~1M requests/month and 400k GB-sec of compute, **forever** (not 12-month). CloudFront's free tier covers 1 TB/month of data transfer out for the first 12 months and then pennies thereafter.
- **Strong resume bullet.** "I configured serverless Next.js on AWS Lambda with CloudFront CDN, S3 origin via OAC, and IAM-scoped Lambda execution roles" is a meaningful sentence in an interview. App Runner reduces to "I pushed a container."
- **Future-proof architecture.** The same Lambda pattern extends to Stage 2's sync workers and Stage 3's API endpoints. We're building the AWS-serverless mental model once.
- **Independent components.** Static asset deploys, server code deploys, and CDN config changes are all independent operations. Lower blast radius than a monolithic container deploy.

### Negative

- **More Terraform.** ~400 LOC vs ~120 for App Runner. Three new resource types we haven't touched (CloudFront, S3 with OAC, Lambda Function URLs).
- **Iteration cost on CDN changes.** CloudFront propagates changes globally over 10–15 minutes; any `terraform apply` to the distribution is a noticeable wait.
- **Cold starts visible to users.** First request after idle is ~500–1500 ms. For a low-traffic job tracker this is acceptable; for a real-time app it wouldn't be.
- **Build pipeline complexity.** OpenNext produces multiple artifact directories that each need to land in different places. Either we ship a `Makefile`/`deploy.sh` that does this, or we wire it into CI. Either way, more moving parts than `git push` to Amplify.
- **Less-trodden integration.** OpenNext + native Terraform isn't as common as OpenNext + SST or OpenNext + CDK. Less Stack Overflow signal when something breaks.

### Mitigations

- Iteration cost is reduced by splitting the web module into "static" (S3 + CloudFront, slow to change) and "dynamic" (Lambdas, fast to change). Most code-only deploys won't touch CloudFront.
- Cold starts can be reduced with Lambda provisioned concurrency, but at a cost (~$5/month per provisioned instance). We accept cold starts for dev; revisit for prod.
- Build pipeline lives in `app/apps/web/scripts/build-and-package.sh`, invoked manually for now and wireable to GitHub Actions later.

## Alternatives considered

### App Runner
- **Pros:** Container deploy, no build adapter, ~120 LOC of Terraform.
- **Cons:** $5/mo idle minimum even with no traffic. Weak resume signal — App Runner is a "managed container service," fewer talking points.
- **Why rejected:** Cost floor and weaker resume signal. App Runner is the right answer if speed-to-deploy matters more than learning AWS internals; here it doesn't.

### AWS Amplify Hosting
- **Pros:** Easiest possible deploy. Native Next.js support. AWS-billed.
- **Cons:** Architecture is hidden — Amplify uses OpenNext + Lambda + CloudFront under the hood but you never touch any of it. Terraform support is incomplete; would force partial console management.
- **Why rejected:** Defeats the purpose of building this as a learning/resume project. Architecturally identical to what we picked but with no learning surface.

### Vercel
- **Pros:** Best-in-class Next.js deploys. Generous free tier.
- **Cons:** Not on AWS. Contradicts the project's "AWS migration" narrative. Limited Terraform integration.
- **Why rejected:** Project is explicitly an AWS-native rewrite. Vercel hosting would invalidate that framing.

## Implementation plan

This decision lands in `infra/modules/web/` in a separate commit. Concretely:

1. S3 bucket for static assets, blocked from public access, served via CloudFront OAC.
2. Lambda function for SSR (`server-function/`), packaged as a zip uploaded to S3 or directly.
3. Lambda function for image optimization (`image-optimization-function/`).
4. CloudFront distribution with three behaviors:
   - `/_next/static/*` → S3 (cached aggressively)
   - `/_next/image*` → image-optimization Lambda
   - `/*` → server Lambda (no caching for HTML by default)
5. IAM roles for each Lambda, scoped to read necessary DynamoDB tables.
6. Function URL on each Lambda (no API Gateway — saves cost and complexity).

OpenNext build script lives alongside the Next.js app and produces the artifacts the Terraform module consumes.

## Revisit triggers

This decision should be reconsidered if:

- Cold starts become user-visible enough to hurt the product (move to App Runner or provisioned concurrency).
- The build/deploy pipeline becomes a constant source of friction (move to Amplify and accept the abstraction).
- We hit a Next.js feature that doesn't work on Lambda + OpenNext (rare, but possible).
- Costs unexpectedly exceed App Runner's $5/mo floor (highly unlikely below 100k MAU).
