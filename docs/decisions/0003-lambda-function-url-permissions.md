# ADR-0003: Lambda Function URLs need TWO permission statements

**Status:** accepted
**Date:** 2026-05-13

## Context

Stage 1's web tier deploys two Lambda functions (Next.js SSR + image optimization), each fronted by a Lambda Function URL with `authorization_type = NONE` so CloudFront can call them without IAM signing. The Terraform initially included one `aws_lambda_permission` resource per function granting public access:

```hcl
resource "aws_lambda_permission" "server_public_invoke" {
  statement_id           = "AllowPublicInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.server.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}
```

This matches what most online tutorials and AWS blog posts show. The resource-based policy looked correct when inspected with `aws lambda get-policy`. But every HTTP request — whether through CloudFront or directly to the Function URL — returned:

```
HTTP/1.1 403 Forbidden
x-amzn-errortype: AccessDeniedException
{"Message":"Forbidden. For troubleshooting Function URL authorization issues, see: ..."}
```

`aws lambda invoke` from the CLI succeeded (StatusCode 200, full HTML response). DynamoDB IAM worked. The Lambda code ran fine end-to-end. Only public HTTP entry to the Function URL was blocked.

Hours of debugging ruled out:

- Authorization type (confirmed `NONE`)
- Resource policy contents (verified Principal=`*`, Action=`lambda:InvokeFunctionUrl`, Condition=`AuthType=NONE`)
- Region mismatch (all in `us-east-1`)
- Lambda quotas (default 1000 concurrent executions)
- CloudFront caching the 403
- Recreating the Function URL via `terraform taint`

A third-party agent surfaced the answer: **a second permission statement is required.** Once it was added, the public URL returned 200 on the first request.

## Decision

**Every public Lambda Function URL must have two resource-based permission statements**, not one:

```hcl
# 1. The one most tutorials show. Allows lambda:InvokeFunctionUrl
#    (the URL-level invoke), gated on the URL's AuthType being NONE.
resource "aws_lambda_permission" "server_invoke_url" {
  statement_id           = "AllowPublicInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.server.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# 2. The one most tutorials OMIT. Also required. Allows lambda:InvokeFunction
#    (the underlying function invoke), gated on the request having come
#    *through* a Function URL.
resource "aws_lambda_permission" "server_invoke_function_via_url" {
  statement_id  = "AllowPublicInvokeFunctionViaFunctionUrl"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.server.function_name
  principal     = "*"

  # NOTE: This statement uses lambda:InvokedViaFunctionUrl as a *condition*,
  # not the function_url_auth_type Terraform shortcut. The shortcut only
  # generates the first statement type.
  source_arn = null
}
```

In the produced policy this surfaces as:

```json
{
  "Sid": "AllowPublicInvokeFunctionViaFunctionUrl",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "lambda:InvokeFunction",
  "Resource": "arn:aws:lambda:us-east-1:...:function:jobtracker-dev-web-server",
  "Condition": {
    "Bool": { "lambda:InvokedViaFunctionUrl": "true" }
  }
}
```

Both statements live in `infra/modules/web/main.tf` for the SSR and image-optimization Lambdas.

## Why two statements

AWS evaluates Function URL requests as two distinct API calls:

1. **`lambda:InvokeFunctionUrl`** — "may this principal use the Function URL at all?" Gated by `lambda:FunctionUrlAuthType=NONE`.
2. **`lambda:InvokeFunction`** — "may this principal then invoke the underlying function?" Gated by `lambda:InvokedViaFunctionUrl=true` (so the permission applies only to invokes that arrived through the URL, not direct SDK calls).

Both must allow the call for the request to succeed. Most tutorials cover only #1 because #2 is implicit in the *console* UX — when you create a Function URL with public auth in the AWS Console, the console silently adds **both** statements. When Terraform creates the Function URL, only the explicit `aws_lambda_permission` resources are added, so the second statement must be created manually.

## Consequences

### Positive

- Function URLs work as intended for public traffic.
- The pattern is now documented for every future Function URL we create (Stage 2 sync workers won't use Function URLs, but Stage 3 webhooks might).
- War story for interviews — concrete example of "AWS docs disagree with AWS tutorials, trust the docs."

### Negative

- One more resource per Function URL. Manageable.
- The condition key `lambda:InvokedViaFunctionUrl` is documented but easy to miss — anyone reading our Terraform will need a comment pointing here. Comment added in `modules/web/main.tf`.

### Discovery cost

Several hours of debugging in one session. Specifically expensive because:

- The error message ("Forbidden. For troubleshooting Function URL authorization issues...") points at the auth-type setting, not the missing permission.
- Tutorials and Stack Overflow answers near-universally show only the first statement.
- `aws lambda get-policy` shows the first statement, which looks complete to anyone who hasn't seen this gotcha.

## References

- AWS docs — [Function URL access control](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html#urls-permissions)
- AWS docs — [Condition keys for Lambda](https://docs.aws.amazon.com/service-authorization/latest/reference/list_awslambda.html#awslambda-policy-keys) — `lambda:InvokedViaFunctionUrl`
- Terraform `aws_lambda_permission` resource [docs](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/lambda_permission) — see `function_url_auth_type` argument
