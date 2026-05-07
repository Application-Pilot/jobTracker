# Gmail Sync Setup (Cloud Run + Cloud Scheduler)

The supported sync path is Cloud Scheduler calling the deployed `POST /api/sync` route. The older Apps Script flow is deprecated and intentionally disabled.

## How it works

1. `POST /api/sync`
   - Searches Gmail for recent job-related threads
   - Extracts structured application data with Gemini
   - Sends results to `/api/applications/upsert`
   - Rate-limits requests to stay under Gemini quota

2. `/api/applications/upsert`
   - Deduplicates by `gmailThreadId` first, then `emailSubject + emailDate`
   - Updates existing sheet rows or appends new ones

3. Cloud Scheduler
   - Calls `POST /api/sync` every 15 minutes
   - Includes an OIDC identity token plus `X-Sync-Secret: <SYNC_SHARED_SECRET>` when configured

## Required Environment

Cloud Run must have all of these for scheduler-driven sync to work:

```bash
GOOGLE_SHEETS_ID=...
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_SERVICE_ACCOUNT_KEY=...
GEMINI_API_KEY=...
GMAIL_REFRESH_TOKEN=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
SYNC_SHARED_SECRET=...
```

`DASHBOARD_BASE_URL` is mainly for local scripts. The deployed `/api/sync` route can fall back to the incoming request origin.

## Local Validation

You can still validate the sync logic locally:

```bash
GOOGLE_SHEETS_ID=... \
GOOGLE_SERVICE_ACCOUNT_EMAIL=... \
GOOGLE_SERVICE_ACCOUNT_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
GEMINI_API_KEY=... \
GMAIL_REFRESH_TOKEN=... \
GMAIL_CLIENT_ID=... \
GMAIL_CLIENT_SECRET=... \
DASHBOARD_BASE_URL=http://localhost:3000 \
node sync-worker.js
```

Expected logs look like:

```text
Starting sync...
Searching Gmail...
Found N threads
Processing X threads this run
1/X thread-id
  -> Job Title at Company
Extracted N applications
Upsert response: 200 {...}
```

## Deploy and Schedule

1. Run `./deploy.sh`
2. Run `./CREATE_SCHEDULER.sh`
3. Test the scheduler manually:

```bash
gcloud scheduler jobs run jobtracker-sync --location=us-central1
gcloud run logs read jobtracker --limit 100 --region=us-central1
```

## Bulk Sync Note

`/api/bulk-sync` is a local-only backfill tool. If bulk sync worked locally but the scheduler is not updating rows later, that usually means the deployed `/api/sync` path is missing env vars or auth is misconfigured.

## Troubleshooting

- `Missing GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, or GMAIL_CLIENT_SECRET`
  The deployed service does not have Gmail OAuth env vars.

- Sync runs but rows do not update
  Check `SYNC_SHARED_SECRET`, Cloud Run logs, and whether the deployed service can reach Gmail and Gemini. Recreate the scheduler job after auth-header changes.

- Upsert fails in production
  Check Cloud Run logs for the `/api/sync` request and confirm the request made it to `/api/applications/upsert`.

- Old Apps Script references
  Ignore `apps-script/`; it is retained only as a deprecation stub.
