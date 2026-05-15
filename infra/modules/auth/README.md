# modules/auth

Cognito User Pool federated against Google. Federated-only — no password support.

## Resources created

| Resource | Purpose |
|---|---|
| `aws_cognito_user_pool.main` | The user database. MFA off (Google handles it). Deletion protection on. |
| `aws_cognito_user_pool_domain.main` | Hosted UI at `https://jobtracker-{env}.auth.us-east-1.amazoncognito.com` |
| `aws_cognito_identity_provider.google` | Google as the only IdP. Maps Google's `email`, `name`, `sub` to Cognito attributes. |
| `aws_cognito_user_pool_client.web` | The OAuth client the Next.js app uses. Code flow, openid+profile+email scopes. |

## Usage

```hcl
module "auth" {
  source = "../../modules/auth"

  project     = "jobtracker"
  environment = "dev"

  google_client_id     = var.google_client_id     # from terraform.tfvars
  google_client_secret = var.google_client_secret # from terraform.tfvars

  callback_urls = [
    "https://d2etjfsuqxfql6.cloudfront.net/api/auth/callback",
    "http://localhost:3001/api/auth/callback",
  ]

  logout_urls = [
    "https://d2etjfsuqxfql6.cloudfront.net/",
    "http://localhost:3001/",
  ]
}
```

## Cost

**$0** within the Cognito User Pool free tier (50,000 monthly active users). Cognito doesn't charge for the hosted UI or for federated identities below that bar. Realistic projection for ≤500 students: $0/month.

## Important Google Cloud Console setup

Two URIs must be registered on the Google OAuth client used for `google_client_id` / `google_client_secret`:

1. **Authorized JavaScript origins** — include `https://jobtracker-{env}.auth.us-east-1.amazoncognito.com` and the app's CloudFront/localhost origins.

2. **Authorized redirect URIs** — must include the value of the `google_idp_callback_url` output:
   ```
   https://jobtracker-{env}.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
   ```

   If you don't register this, Google rejects the redirect after consent with `redirect_uri_mismatch`.

## Notes

- The user pool is set up such that **users authenticate via Google but Cognito issues the app's tokens**. The Next.js app validates Cognito's tokens, not Google's. This means losing the Google OAuth client (deleting it, rotating its secret) breaks new sign-ins but doesn't immediately log out existing users.
- The hosted UI's appearance can be customized via `aws_cognito_user_pool_ui_customization` (logo, CSS). Skipped for now; revisit in Stage 3 polish.
- Federated-only is intentional. To add Cognito-managed username/password later, add `"COGNITO"` to `supported_identity_providers` and configure password policy. This is a one-line change but adds account-recovery surface area.

## Migration plan to custom UI (future Stage 3)

The Cognito Hosted UI is functional but AWS-branded. To migrate to a custom UI in your Next.js app:

1. Add the AWS Amplify auth client to `app/apps/web/`
2. Replace the hosted-UI redirect with a custom "Sign in with Google" button
3. Use Amplify's `signInWithRedirect({ provider: 'Google' })` to kick off the flow
4. No Terraform changes needed — the same user pool, IdP, and client work for either UI

Deferred so we ship Stage 2 faster.
