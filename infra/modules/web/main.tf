# =============================================================================
# main.tf — Web tier: Lambda + CloudFront + S3 via OpenNext
# =============================================================================
#
# This module deploys a Next.js app that has been built with OpenNext
# (@opennextjs/aws). The pieces:
#
#   1. S3 bucket holding static assets (JS bundles, CSS, public/ files).
#      Accessed only by CloudFront via Origin Access Control (OAC) —
#      never publicly readable.
#
#   2. Two Lambda functions:
#      - server: runs the Next.js handler for pages and API routes
#      - image:  runs the Next.js image optimizer (/_next/image)
#      Both have Function URLs (no API Gateway — saves cost + complexity).
#      The server Lambda is granted DynamoDB read on the users table.
#
#   3. CloudFront distribution with three behaviors:
#      - /_next/static/* and /static/* and /favicon.ico → S3 (cached hard)
#      - /_next/image*                                  → image Lambda
#      - everything else                                → server Lambda
#
# All requests enter via CloudFront, which provides the public URL, TLS,
# edge caching, and DDoS protection (AWS Shield Standard is free).
# =============================================================================

# Locals derive consistent names so we don't repeat string interpolation.
# Also resolves the OpenNext build directories from the input path.
locals {
  name_prefix = "${var.project}-${var.environment}"

  # Sub-paths inside the OpenNext build output. Layout produced by
  # @opennextjs/aws 3.x as of mid-2025.
  open_next_assets_dir = "${var.open_next_dir}/assets"
  open_next_server_dir = "${var.open_next_dir}/server-functions/default"
  open_next_image_dir  = "${var.open_next_dir}/image-optimization-function"
}

# =============================================================================
# Data sources — discover account ID and region for ARN construction
# =============================================================================

# aws_caller_identity returns the AWS account ID we're authenticated as.
# Used in IAM policy resource ARNs.
data "aws_caller_identity" "current" {}

# aws_region returns the region the provider is configured for.
# Used in Lambda Function URL strings and a few other places.
data "aws_region" "current" {}

# =============================================================================
# S3 — static assets bucket
# =============================================================================
#
# Holds files like /_next/static/chunks/*.js, /_next/static/css/*.css, plus
# anything from /public (favicons, images). These are immutable per build —
# Next.js fingerprints filenames with content hashes, so cache-busting is
# handled by URL changes, not by S3 versioning.
# =============================================================================

resource "aws_s3_bucket" "assets" {
  # Bucket names are globally unique. Account ID suffix guarantees uniqueness
  # without revealing anything sensitive (account ID is not a secret).
  bucket = "${local.name_prefix}-web-assets-${data.aws_caller_identity.current.account_id}"

  # force_destroy = true makes `terraform destroy` work even if the bucket
  # has objects in it. Without this, you'd have to manually empty the bucket
  # before destroy. For non-production buckets where contents are reproducible
  # from a build, this is the right tradeoff.
  force_destroy = true

  tags = {
    Name      = "${local.name_prefix}-web-assets"
    Component = "web"
  }
}

# Encrypt everything written to the bucket. CloudFront still serves
# everything unencrypted at the edge after decrypting from S3, so this is
# purely about at-rest protection on the origin.
resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block every form of public access. CloudFront accesses the bucket via
# Origin Access Control (OAC), which signs requests with the distribution's
# identity — no public ACLs needed.
resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Object ownership: BucketOwnerEnforced disables ACLs entirely. Modern best
# practice — ACL-based access control is legacy. Policies do the work now.
resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# -----------------------------------------------------------------------------
# Upload OpenNext assets to S3
# -----------------------------------------------------------------------------
#
# fileset() walks the .open-next/assets/ directory recursively and gives us
# a set of relative paths. for_each on aws_s3_object turns each file into
# an S3 object. Effect: every file in .open-next/assets/ becomes an object
# in the bucket at the same relative path.
#
# Important: this means `terraform apply` reuploads any changed file. The
# etag tracks content hash, so unchanged files are skipped. For large asset
# sets this is fine. For very large apps a separate deploy script (rsync
# style) would be faster, but we don't need it here.
# -----------------------------------------------------------------------------

resource "aws_s3_object" "assets" {
  for_each = fileset(local.open_next_assets_dir, "**")

  bucket = aws_s3_bucket.assets.id
  key    = each.value
  source = "${local.open_next_assets_dir}/${each.value}"
  etag   = filemd5("${local.open_next_assets_dir}/${each.value}")

  # Sets the right Content-Type per extension so browsers don't get confused.
  # The lookup table covers what Next.js typically ships. Fallback is
  # application/octet-stream (which forces download — not what we want for
  # unknown types but a safe-ish default).
  content_type = lookup(
    {
      "js"    = "application/javascript"
      "mjs"   = "application/javascript"
      "css"   = "text/css"
      "html"  = "text/html"
      "json"  = "application/json"
      "svg"   = "image/svg+xml"
      "png"   = "image/png"
      "jpg"   = "image/jpeg"
      "jpeg"  = "image/jpeg"
      "gif"   = "image/gif"
      "webp"  = "image/webp"
      "ico"   = "image/x-icon"
      "txt"   = "text/plain"
      "xml"   = "application/xml"
      "woff"  = "font/woff"
      "woff2" = "font/woff2"
    },
    lower(reverse(split(".", each.value))[0]),
    "application/octet-stream",
  )

  # Aggressive caching: /_next/static/* files are content-hashed, so they
  # never need to be revalidated. immutable + max-age=1y is canonical.
  # For non-hashed files (favicons, etc.) this is also fine — they're rare.
  cache_control = "public, max-age=31536000, immutable"
}

# =============================================================================
# CloudFront Origin Access Control (OAC)
# =============================================================================
#
# OAC is the modern replacement for Origin Access Identity (OAI). It lets
# CloudFront sign S3 requests with SigV4 — proving "this request really
# came from this distribution" — so the bucket can stay private.
# =============================================================================

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "${local.name_prefix}-web-assets-oac"
  description                       = "OAC for the ${local.name_prefix} web assets bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Bucket policy: allow GetObject from CloudFront when the request comes
# from our specific distribution. The condition on AWS:SourceArn is the
# critical line — without it any account's CloudFront could read this bucket.
resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontReadViaOAC"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.assets.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.web.arn
          }
        }
      },
    ]
  })

  # Don't try to set the policy until both the bucket policy block and the
  # CloudFront distribution exist. Terraform usually figures dependencies
  # out from reference, but this explicit list documents intent.
  depends_on = [
    aws_s3_bucket_public_access_block.assets,
  ]
}

# =============================================================================
# Session secret — random string used by the app to wrap session cookies
# =============================================================================
#
# Generated once and stored in Terraform state. The lifecycle ignore on
# the result attribute means subsequent applies won't regenerate it
# (which would log every user out). To rotate, taint this resource.
# =============================================================================

resource "random_password" "session_secret" {
  length  = 64
  special = false # alphanumeric only — safer to round-trip through env vars
}

# =============================================================================
# Lambda functions (server + image optimization)
# =============================================================================
#
# Both Lambdas need:
#   1. An IAM role they assume when they run (the "execution role").
#   2. A zip of the function code, uploaded by Terraform.
#   3. A Function URL — direct HTTPS endpoint, no API Gateway in between.
#
# The server Lambda additionally needs DynamoDB read on the users table,
# granted via an inline policy on its execution role.
# =============================================================================

# -----------------------------------------------------------------------------
# IAM — assume role policy used by both Lambdas
# -----------------------------------------------------------------------------
#
# Every Lambda function needs an execution role with a trust policy that
# says "lambda.amazonaws.com is allowed to assume me". This data source
# constructs that exact policy as JSON. Reused for both functions.
# -----------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

# -----------------------------------------------------------------------------
# Server Lambda — IAM role and policies
# -----------------------------------------------------------------------------

resource "aws_iam_role" "server" {
  name               = "${local.name_prefix}-web-server"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

# AWSLambdaBasicExecutionRole is an AWS-managed policy that grants Lambda
# the permission to write CloudWatch Logs. Without this, the Lambda runs
# but you can't see its logs — which makes debugging impossible.
resource "aws_iam_role_policy_attachment" "server_basic_execution" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Inline policy: access to the users DynamoDB table. Scoped narrowly:
#   - Scan + Query + GetItem for the home page
#   - PutItem + UpdateItem for user sign-in upserts and Gmail connect state
#   - Only on the users table ARN (not other tables)
#
# As the app grows we'll either expand this policy or split into multiple
# policies for clarity.
data "aws_iam_policy_document" "server_dynamodb" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:Scan",
      "dynamodb:Query",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
    ]
    resources = [
      var.users_table_arn,
      "${var.users_table_arn}/index/*", # GSIs, if any are added later
    ]
  }
}

resource "aws_iam_role_policy" "server_dynamodb" {
  name   = "${local.name_prefix}-web-server-dynamodb"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.server_dynamodb.json
}

data "aws_iam_policy_document" "server_kms_tokens" {
  statement {
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
    ]
    resources = [var.token_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "server_kms_tokens" {
  name   = "${local.name_prefix}-web-server-kms-tokens"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.server_kms_tokens.json
}

# -----------------------------------------------------------------------------
# Server Lambda — packaging and deployment
# -----------------------------------------------------------------------------
#
# archive_file zips the OpenNext server-function/default/ directory into a
# single .zip in the Terraform working directory. The hash of the source
# files becomes the etag, so Terraform can detect "the code changed" and
# trigger an update without us doing anything special.
# -----------------------------------------------------------------------------

data "archive_file" "server" {
  type        = "zip"
  source_dir  = local.open_next_server_dir
  output_path = "${path.module}/.build/server.zip"
}

resource "aws_lambda_function" "server" {
  function_name = "${local.name_prefix}-web-server"
  role          = aws_iam_role.server.arn

  filename         = data.archive_file.server.output_path
  source_code_hash = data.archive_file.server.output_base64sha256

  runtime = var.lambda_runtime
  # OpenNext's server function exposes a handler named `handler` in `index.mjs`.
  handler = "index.handler"

  memory_size = var.server_lambda_memory_mb
  timeout     = var.server_lambda_timeout_s

  environment {
    variables = {
      # Tell the app where to find its data. Read by app/apps/web/app/page.tsx.
      USERS_TABLE = var.users_table_name
      # Some Next.js internals expect this to be set explicitly in Lambda.
      NODE_ENV = "production"

      # ----- Cognito wiring (Stage 2, Session A) -----
      # The Lambda fetches Cognito's JWKS from a URL derived from the user
      # pool ID, then verifies signed JWTs on incoming requests.
      COGNITO_USER_POOL_ID = var.cognito_user_pool_id
      COGNITO_CLIENT_ID    = var.cognito_client_id
      # Client secret is used by /api/auth/callback when exchanging the
      # OAuth code for tokens.
      COGNITO_CLIENT_SECRET = var.cognito_client_secret
      # The hosted-UI domain — also used to compute the JWKS URL and the
      # initial login redirect.
      COGNITO_DOMAIN = var.cognito_domain_full_url

      # Public app URL. Used to construct redirect_uri values for the
      # OAuth code flow. NEXT_PUBLIC_ prefix would expose it to the
      # browser, but server-only Lambdas don't need that distinction; we
      # keep it as a plain server env var.
      APP_URL = var.app_url

      # ----- Gmail OAuth wiring (Stage 2, Session B) -----
      # Direct Google OAuth client used only for gmail.readonly consent.
      GMAIL_OAUTH_CLIENT_ID     = var.gmail_oauth_client_id
      GMAIL_OAUTH_CLIENT_SECRET = var.gmail_oauth_client_secret

      # Customer-managed KMS key for encrypting Gmail refresh tokens.
      TOKEN_KMS_KEY_ARN = var.token_kms_key_arn

      # Random secret used by the app to sign/encrypt the session cookie
      # contents (the access token is wrapped, not bare). Created by the
      # random_password resource below; lifecycle keeps it stable across
      # plans (so signing a session cookie one minute and reading it the
      # next still works).
      SESSION_SECRET = random_password.session_secret.result
    }
  }

  tags = {
    Name      = "${local.name_prefix}-web-server"
    Component = "web"
  }
}

# Function URL: a built-in HTTPS endpoint. Faster and cheaper than API
# Gateway in front of a Lambda, with one tradeoff: no request transformation
# layer. We don't need one (CloudFront handles routing).
#
# AuthType NONE = anyone with the URL can call it. That's intentional —
# CloudFront is the only legitimate caller, and CloudFront does its own
# auth via signed requests if/when we add origin auth. For dev,
# unauthenticated is fine; the URL is unpublicized.
resource "aws_lambda_function_url" "server" {
  function_name      = aws_lambda_function.server.function_name
  authorization_type = "NONE"

  invoke_mode = "BUFFERED" # streaming responses (RESPONSE_STREAM) not used yet
}

# Even with authorization_type = NONE, Lambda Function URLs require explicit
# resource-based permissions to allow public invocation. Since October 2025,
# new Function URLs require both lambda:InvokeFunctionUrl and
# lambda:InvokeFunction. Without both, every call returns 403 "Forbidden. For
# troubleshooting Function URL authorization issues, see..." — a notorious AWS
# gotcha.
#
# function_url_auth_type = "NONE" must match the function URL above.
resource "aws_lambda_permission" "server_public_invoke" {
  statement_id           = "AllowPublicInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.server.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# Allow the Function URL front door to invoke the underlying Lambda function.
# invoked_via_function_url scopes this permission to Function URL traffic only.
resource "aws_lambda_permission" "server_public_invoke_function" {
  statement_id             = "AllowPublicInvokeFunctionViaFunctionUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.server.function_name
  principal                = "*"
  invoked_via_function_url = true
}

# -----------------------------------------------------------------------------
# Image-optimization Lambda — same shape, different code
# -----------------------------------------------------------------------------

resource "aws_iam_role" "image" {
  name               = "${local.name_prefix}-web-image"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "image_basic_execution" {
  role       = aws_iam_role.image.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Image-optimization needs to read source images from the assets bucket
# (the original images shipped with the app) and from any remote sources
# we configure in next.config.mjs. Today we only read from S3.
data "aws_iam_policy_document" "image_s3_read" {
  statement {
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.assets.arn}/*"]
  }
}

resource "aws_iam_role_policy" "image_s3_read" {
  name   = "${local.name_prefix}-web-image-s3-read"
  role   = aws_iam_role.image.id
  policy = data.aws_iam_policy_document.image_s3_read.json
}

data "archive_file" "image" {
  type        = "zip"
  source_dir  = local.open_next_image_dir
  output_path = "${path.module}/.build/image.zip"
}

resource "aws_lambda_function" "image" {
  function_name = "${local.name_prefix}-web-image"
  role          = aws_iam_role.image.arn

  filename         = data.archive_file.image.output_path
  source_code_hash = data.archive_file.image.output_base64sha256

  runtime = var.lambda_runtime
  handler = "index.handler"

  memory_size = var.image_lambda_memory_mb
  timeout     = var.image_lambda_timeout_s

  environment {
    variables = {
      BUCKET_NAME = aws_s3_bucket.assets.id
      NODE_ENV    = "production"
    }
  }

  tags = {
    Name      = "${local.name_prefix}-web-image"
    Component = "web"
  }
}

resource "aws_lambda_function_url" "image" {
  function_name      = aws_lambda_function.image.function_name
  authorization_type = "NONE"
  invoke_mode        = "BUFFERED"
}

resource "aws_lambda_permission" "image_public_invoke" {
  statement_id           = "AllowPublicInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.image.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "image_public_invoke_function" {
  statement_id             = "AllowPublicInvokeFunctionViaFunctionUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.image.function_name
  principal                = "*"
  invoked_via_function_url = true
}

# =============================================================================
# CloudFront distribution
# =============================================================================
#
# This is the public entry point. It routes incoming requests to the right
# origin (S3 or one of the two Lambdas) based on URL pattern.
#
# Why CloudFront in front of Lambda:
#   - Provides TLS automatically with an AWS cert
#   - Caches static assets at edges worldwide
#   - Provides DDoS protection (Shield Standard, free)
#   - Lets us add custom domains later via CNAME
#   - Hides the Lambda Function URLs (which leak internal naming if exposed)
# =============================================================================

# Cache policy for static assets — cache aggressively at edges.
# AWS provides managed cache policies but defining our own gives clarity
# and tweakability.
#
# Why ALL of TTLs (min/default/max)?
#   - max-age headers from the origin can override the default TTL up to max
#   - min ensures we don't cache things shorter than this even if the
#     origin says so (S3 doesn't, but defensive)
resource "aws_cloudfront_cache_policy" "static_assets" {
  name        = "${local.name_prefix}-web-static-cache"
  default_ttl = 86400    # 1 day default if no Cache-Control on the origin
  max_ttl     = 31536000 # 1 year max
  min_ttl     = 1

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none" # static assets don't vary by cookie
    }
    headers_config {
      header_behavior = "none" # don't include headers in cache key
    }
    query_strings_config {
      query_string_behavior = "none" # static assets don't vary by query string
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# Cache policy for the server Lambda — don't cache (dynamic content).
# We define this rather than use "Managed-CachingDisabled" so we can also
# include cookies in the request to the origin (needed for auth in Stage 2).
resource "aws_cloudfront_cache_policy" "dynamic" {
  name        = "${local.name_prefix}-web-dynamic-cache"
  default_ttl = 0
  max_ttl     = 1
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "all" # forward all cookies to Lambda for auth
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "all" # forward all query strings
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# Origin request policy: what we forward to the origin (server Lambda).
# Lambda Function URLs need specific headers stripped (Host is replaced
# automatically by CloudFront when proxying to Lambda).
resource "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "${local.name_prefix}-web-all-viewer"

  cookies_config {
    cookie_behavior = "all"
  }
  # "allExcept" forwards every viewer header except those listed. We drop
  # Host because Lambda Function URLs rewrite the Host header themselves;
  # passing the original Host (which would be the CloudFront domain) breaks
  # the signed request to the Lambda URL.
  headers_config {
    header_behavior = "allExcept"
    headers {
      items = ["host"]
    }
  }
  query_strings_config {
    query_string_behavior = "all"
  }
}

resource "aws_cloudfront_distribution" "web" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${local.name_prefix} web tier (Lambda + S3 via OpenNext)"

  price_class = var.cloudfront_price_class

  # ---------------------------------------------------------------------------
  # Origins — where CloudFront fetches from
  # ---------------------------------------------------------------------------
  #
  # Three origins:
  #   1. S3 assets bucket (signed via OAC)
  #   2. Server Lambda Function URL
  #   3. Image-optimization Lambda Function URL
  # ---------------------------------------------------------------------------

  origin {
    origin_id                = "s3-assets"
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
    # No s3_origin_config block — using OAC, not OAI.
  }

  origin {
    origin_id = "lambda-server"
    # Function URL looks like "https://abc.lambda-url.us-east-1.on.aws/" —
    # we strip the protocol and trailing slash for CloudFront.
    domain_name = replace(replace(aws_lambda_function_url.server.function_url, "https://", ""), "/", "")

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  origin {
    origin_id   = "lambda-image"
    domain_name = replace(replace(aws_lambda_function_url.image.function_url, "https://", ""), "/", "")

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # ---------------------------------------------------------------------------
  # Behaviors — pattern matching that routes requests to origins
  # ---------------------------------------------------------------------------
  #
  # Order matters: CloudFront checks ordered behaviors first, in declaration
  # order, then falls through to default_cache_behavior. We have three
  # ordered behaviors (static, image, plus a redundant favicon shortcut)
  # and the default goes to the server Lambda.
  # ---------------------------------------------------------------------------

  # Default behavior: everything not matched below goes here → server Lambda
  default_cache_behavior {
    target_origin_id       = "lambda-server"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = aws_cloudfront_cache_policy.dynamic.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # /_next/static/* — Next.js's hashed static assets → S3
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "s3-assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = aws_cloudfront_cache_policy.static_assets.id
  }

  # /_next/image* — Next.js image optimization → image Lambda
  ordered_cache_behavior {
    path_pattern           = "/_next/image*"
    target_origin_id       = "lambda-image"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = aws_cloudfront_cache_policy.static_assets.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # /favicon.ico, /robots.txt, /sitemap.xml — common root-level static files → S3
  # Next.js puts these in /public/, which OpenNext copies to /assets/.
  ordered_cache_behavior {
    path_pattern           = "/favicon.ico"
    target_origin_id       = "s3-assets"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = aws_cloudfront_cache_policy.static_assets.id
  }

  # ---------------------------------------------------------------------------
  # TLS, restrictions, viewer cert
  # ---------------------------------------------------------------------------

  viewer_certificate {
    # Use the default CloudFront cert — gets us a *.cloudfront.net URL
    # with valid TLS out of the box. Custom domain + ACM cert is a
    # Stage 3 follow-up.
    cloudfront_default_certificate = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = {
    Name      = "${local.name_prefix}-web"
    Component = "web"
  }
}
