# Job Application Tracker

Jobtracker is a Next.js dashboard backed by Google Sheets. Job-related Gmail messages are read through the Gmail API, parsed by Gemini, written into the `Applications` sheet tab, and displayed in the dashboard.

```text
Cloud Scheduler -> POST /api/sync -> /api/applications/upsert -> Google Sheet <-> Next.js Dashboard
```

Legacy Google Apps Script sync is deprecated and intentionally disabled. The file in `apps-script/Code.gs` is only a stub so nobody accidentally sets up the old flow.

## What Lives Where

- `src/app/Dashboard.tsx` — dashboard UI
- `src/app/api/applications/*` — CRUD API over the sheet
- `src/app/api/applications/upsert/route.ts` — idempotent sync write endpoint
- `src/app/api/sync/route.ts` — scheduled Gmail -> Gemini -> upsert sync
- `src/app/api/bulk-sync/route.ts` — local-only historical backfill
- `src/lib/sheets.ts` — Google Sheets client
- `src/lib/types.ts` — application schema and sheet column order
- `deploy.sh` — deploys the app to Cloud Run
- `CREATE_SCHEDULER.sh` — creates the Cloud Scheduler job that hits `/api/sync`

## Local Setup

### 1. Create the Sheet

1. Create a Google Sheet named **Job Applications**.
2. Rename the first tab to `Applications`.
3. Copy the spreadsheet ID from the URL and use it as `GOOGLE_SHEETS_ID`.

The app creates the header row automatically on first load.

### 2. Create a Google Cloud Project and Service Account

1. Create a Google Cloud project.
2. Enable the **Google Sheets API**.
3. Create a service account.
4. Generate a JSON key for that service account.
5. Share the Google Sheet with the service account email as **Editor**.

### 3. Configure `.env.local`

Copy `.env.example` to `.env.local` and fill in:

```bash
GOOGLE_SHEETS_ID=...
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_SERVICE_ACCOUNT_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GEMINI_API_KEY=...
GMAIL_REFRESH_TOKEN=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
DASHBOARD_BASE_URL=http://localhost:3000
SYNC_SHARED_SECRET=
```

Notes:

- `GOOGLE_SERVICE_ACCOUNT_KEY` should stay on one line with literal `\n` separators.
- `DASHBOARD_BASE_URL` is mainly for local sync tooling.
- `SYNC_SHARED_SECRET` is optional, but recommended for Cloud Run + Scheduler.

### 4. Run Locally

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Manual adds and edits should appear in the sheet immediately.

## Sync Modes

### Scheduled Sync

This is the supported production sync path.

1. Cloud Scheduler sends `POST` to your deployed `/api/sync`.
2. `/api/sync` searches Gmail for recent job-related threads.
3. It reads the latest message in each thread.
4. It sends the message text to Gemini for extraction.
5. It posts extracted applications to `/api/applications/upsert`.
6. `/api/applications/upsert` updates or appends rows in Google Sheets.
7. The dashboard picks up changes on refresh or within 30 seconds from polling.

Scheduled sync now keeps a small cursor/state record in a `SyncState` sheet tab so it can:

- skip already-imported `gmailThreadId`s
- page through Gmail results across runs instead of always restarting at the first page
- remember the last processed thread metadata between runs

### Bulk Sync

`/api/bulk-sync` is a local-only backfill tool for historical mail. It is useful for importing old data, but it does not prove the deployed scheduler path is healthy.

If bulk sync works locally and the scheduler still does not update jobs later, the issue is usually:

- Cloud Run missing Gmail OAuth env vars
- `SYNC_SHARED_SECRET` mismatch
- Cloud Scheduler job not created or not running
- Cloud Run logs showing `/api/sync` failures

## Deploy to Cloud Run

### What `deploy.sh` Does

Run:

```bash
./deploy.sh
```

This script does all of the following:

1. Reads env vars from `.env.local`.
2. Reads the service account private key from `cred.json`.
3. Creates or updates a Secret Manager secret for `GOOGLE_SERVICE_ACCOUNT_KEY`.
4. Enables required Google Cloud APIs.
5. Deploys the app to Cloud Run.
6. Passes runtime env vars to Cloud Run, including Gmail OAuth values needed by `/api/sync`.
7. Prints the deployed Cloud Run URL.

Important:

- `./deploy.sh` does **not** invoke the scheduler.
- `./deploy.sh` does **not** create the cron job.
- It only deploys the app that the scheduler will call later.

## Create the Scheduler

### What `CREATE_SCHEDULER.sh` Does

Run:

```bash
./CREATE_SCHEDULER.sh
```

This script:

1. Looks up your deployed Cloud Run URL using `gcloud run services describe`.
2. Reads `SYNC_SHARED_SECRET` from `.env.local`.
3. Deletes the old `jobtracker-sync` scheduler job if it exists.
4. Recreates it as an HTTP job.
5. Configures the schedule as `*/15 * * * *`, which means every 15 minutes.
6. Configures the job to call `POST <cloud-run-url>/api/sync`.
7. Adds the `X-Sync-Secret: <SYNC_SHARED_SECRET>` header and an OIDC identity token.

That means the scheduler is invoked by Google Cloud itself, not by your Next.js app.

After the job is created, Google Cloud Scheduler runs it automatically every 15 minutes. You can also trigger it manually:

```bash
gcloud scheduler jobs run jobtracker-sync --location=us-central1
```

## How the Scheduler Is Actually Invoked

This is the exact lifecycle:

1. You run `./deploy.sh`.
2. Cloud Run gets the latest version of your app.
3. You run `./CREATE_SCHEDULER.sh`.
4. That creates a Google Cloud Scheduler job in your GCP project.
5. Every 15 minutes, Google Cloud Scheduler makes an HTTP `POST` request to your Cloud Run service at `/api/sync`.
6. Your app handles that request and runs the Gmail sync logic.

So if you only ran `./deploy.sh`, the app was deployed, but nothing new was scheduled unless a scheduler job already existed.

## Verify the Scheduler

### Recreate It

```bash
./CREATE_SCHEDULER.sh
```

### Manually Trigger It

```bash
gcloud scheduler jobs run jobtracker-sync --location=us-central1
```

### Inspect Logs

```bash
gcloud run logs read jobtracker --limit 100 --region=us-central1
```

You should see `/api/sync` logs such as:

- `Sync request authorized`
- `Starting sync...`
- `Searching Gmail...`
- `Extracted N applications`
- `Upsert response: 200 ...`

## Useful Behaviors

- Dashboard auto-refreshes every 30 seconds
- Manual add/edit writes directly to the sheet
- Upsert deduplicates by `gmailThreadId` first, then `emailSubject + emailDate`
- Rejected jobs can surface similar open roles
- CSV export downloads the current dataset

## Troubleshooting

- If `/api/sync` says `Missing GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, or GMAIL_CLIENT_SECRET`, Cloud Run does not have the Gmail OAuth env vars.
- If scheduler requests get `401 Unauthorized`, `SYNC_SHARED_SECRET` in Cloud Scheduler and Cloud Run do not match, or the job was created before the `X-Sync-Secret` fix.
- If local bulk sync works but scheduled sync does not, the deployed environment is misconfigured, not the sheet write path.
- If the dashboard looks stale, wait up to 30 seconds or click **Refresh**.
- If `DASHBOARD_BASE_URL` in production points to `localhost`, that value is wrong for Cloud Run.
