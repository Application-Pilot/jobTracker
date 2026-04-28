# Gmail Sync Setup (Node.js + Cloud Run)

The original Apps Script approach is unreliable due to Gemini API quota limits and execution timeouts. This guide replaces it with a Cloud Run-based sync worker that's more robust.

## How it works

1. **sync-worker.js** — Node.js script that:
   - Searches Gmail for job-related keywords (past 14 days)
   - Extracts structured data from each email using Gemini API
   - POSTs results to `/api/applications/upsert`
   - Runs 10 threads at a time with 10s delay (respects Gemini bandwidth quota)

2. **Cloud Scheduler** — Google's cron service that:
   - Calls POST `/api/sync` every day at 9 AM
   - Includes bearer token authentication (SYNC_SHARED_SECRET)

3. **Cloud Run** — Your deployed dashboard:
   - Has `/api/sync` endpoint that spawns `sync-worker.js`
   - Can be invoked by Cloud Scheduler

## Setup

### 1. Test locally

```bash
npm install
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com \
GOOGLE_SERVICE_ACCOUNT_KEY='-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n' \
GEMINI_API_KEY=your-key \
DASHBOARD_BASE_URL=http://localhost:3000 \
node sync-worker.js
```

You should see:
```
Starting sync...
Searching Gmail for: ...
Found N threads
Processing X threads this run
1/X thread-id
  → Job Title at Company
...
Extracted N applications
Upsert response: 200 {...}
```

### 2. Deploy to Cloud Run

Re-run `./deploy.sh` (it already includes sync-worker.js in the Dockerfile).

Test the endpoint:
```bash
DEPLOYED_URL=https://your-app.run.app
curl -X POST $DEPLOYED_URL/api/sync \
  -H 'Authorization: Bearer YOUR_SYNC_SHARED_SECRET' \
  -H 'Content-Type: application/json'
```

### 3. Set up Cloud Scheduler

```bash
gcloud scheduler jobs create http jobtracker-sync \
  --schedule="0 9 * * *" \
  --http-method=POST \
  --uri="$DEPLOYED_URL/api/sync" \
  --oidc-service-account-email=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com \
  --oidc-token-audience="$DEPLOYED_URL" \
  --headers="Authorization: Bearer $SYNC_SHARED_SECRET"
```

Then test:
```bash
gcloud scheduler jobs run jobtracker-sync
# Check Cloud Run logs for output
gcloud run logs read jobtracker --limit 50
```

## Troubleshooting

- **"Bandwidth quota exceeded"** — Gemini is limiting requests. Wait 10 seconds between emails. The default 10s delay should work; if not, the key may need rotation.
- **Gmail search finds nothing** — Check that the KEYWORD_QUERY is correct (past 14 days). Increase LOOKBACK_DAYS in sync-worker.js if needed.
- **Upsert returns 403** — Make sure the deployed dashboard can reach its own `/api/applications/upsert` endpoint. Check DASHBOARD_BASE_URL env var.
- **Check logs** — `gcloud run logs read jobtracker --limit 100`

## No more Apps Script

You can now ignore the `apps-script/` folder and remove the daily trigger from Google Sheets. Cloud Scheduler is more reliable than Apps Script's 6-minute timeout.
