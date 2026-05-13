# modules/web

Lambda + CloudFront + S3 hosting for the Next.js web app, built via OpenNext.

## Architecture

```
                            ┌──────────────────────────┐
   Internet (browser) ────► │  CloudFront distribution │
                            └──────────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
       /_next/static/*           /_next/image*                everything else
       /favicon.ico                                                  │
              │                          │                          │
              ▼                          ▼                          ▼
       ┌─────────────┐          ┌────────────────┐         ┌────────────────┐
       │  S3 bucket  │          │ image Lambda   │         │ server Lambda  │
       │  (via OAC)  │          │ (Function URL) │         │ (Function URL) │
       └─────────────┘          └────────────────┘         └────────────────┘
                                                                    │
                                                                    ▼
                                                           ┌─────────────────┐
                                                           │  DynamoDB users │
                                                           │  table (R only) │
                                                           └─────────────────┘
```

## Resources created

| Resource | Purpose |
|---|---|
| `aws_s3_bucket.assets` | Stores `/_next/static/*` JS/CSS bundles and `/public/` files |
| `aws_s3_bucket_policy.assets` | Grants CloudFront read-only access via OAC |
| `aws_cloudfront_origin_access_control.assets` | OAC identity for CloudFront → S3 |
| `aws_lambda_function.server` | SSR Next.js handler |
| `aws_lambda_function.image` | `/_next/image` optimizer |
| `aws_lambda_function_url.*` | Direct HTTPS endpoints (no API Gateway) |
| `aws_iam_role.server` / `image` | Lambda execution roles |
| `aws_iam_role_policy.server_dynamodb` | Inline DynamoDB read policy for the server Lambda |
| `aws_cloudfront_distribution.web` | The CDN — the only public entry point |
| `aws_cloudfront_cache_policy.*` | Static-aggressive vs dynamic-no-cache policies |
| `aws_cloudfront_origin_request_policy.all_viewer` | Forwards cookies + query strings to Lambda |

## Cost expectations

At placeholder traffic (you + a few friends, ~1k requests/day):

- **Lambda**: well within the 1M req/month + 400k GB-sec free tier. **$0.**
- **CloudFront**: 1 TB free egress for first 12 months. **$0.**
- **S3**: ~1 MB stored, ~free requests. **<$0.01.**
- **DynamoDB**: covered by the data module. **$0.**

Total: effectively $0 at our usage.

## Usage

The module expects you to have already run `pnpm build:lambda` (which runs
`open-next build`) and have a `.open-next/` directory ready to be uploaded.

```hcl
module "web" {
  source = "../../modules/web"

  project           = var.project
  environment       = var.environment
  open_next_dir     = "${path.module}/../../../app/apps/web/.open-next"

  users_table_name  = module.data.users_table_name
  users_table_arn   = module.data.users_table_arn
}

output "web_url" {
  value = module.web.cloudfront_url
}
```

## Deployment flow

```bash
# 1. Build the Next.js app
cd app/apps/web
pnpm build            # Next.js production build
pnpm build:lambda     # OpenNext repackages it for Lambda

# 2. Apply Terraform (uploads new assets + Lambda code)
cd ../../../infra/environments/dev
terraform apply

# 3. Invalidate CloudFront so users see new HTML
aws cloudfront create-invalidation \
  --distribution-id <cloudfront_distribution_id> \
  --paths "/*"
```

The `terraform apply` step is idempotent — if nothing changed, nothing
deploys. The first apply takes ~15 minutes (CloudFront distributions are
slow to create). Subsequent applies that only change Lambda code take
~30 seconds.

## Known limitations

- No custom domain. Default CloudFront URL (`https://<id>.cloudfront.net`)
  only. Custom domain is a Stage 3 follow-up.
- No ISR cache. OpenNext can use DynamoDB for ISR — we skip it for
  the placeholder. Adding it later is one new table + a few env vars.
- No warmer Lambda. OpenNext produces a `warmer-function/` that pings
  the server Lambda to reduce cold starts. We skip it; cold starts are
  acceptable for dev.
- No WAF. CloudFront's free Shield Standard provides DDoS protection.
  WAF (web application firewall) costs $5/month + per-rule fees and is
  unnecessary at our scale.
