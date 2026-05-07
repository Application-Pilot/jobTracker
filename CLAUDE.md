# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Quick Start

```bash
npm run dev          # Start dev server on localhost:3000
npm run build        # Build for production
npm start            # Run production server after build
npm run sync         # Run the sync worker locally
```

## Project Overview

**jobtracker** is a job application dashboard backed by a Google Sheet. Gmail job emails are parsed with Gemini, normalized into application records, written into the `Applications` sheet tab, and displayed in the Next.js dashboard.

Current supported data flow:

```text
Cloud Scheduler -> POST /api/sync -> /api/applications/upsert -> Google Sheet <-> Next.js Dashboard
```

Legacy Apps Script flow is deprecated and intentionally disabled. The file in `apps-script/Code.gs` is now only a stub that throws if someone tries to use it.

The app runs on Next.js 16.2.4 with React 19.2.4 and uses:

- Google Sheets API for persistence
- Gmail API for reading job-related threads
- Gemini API for extraction

## Architecture

### Frontend

- [src/app/Dashboard.tsx](src/app/Dashboard.tsx) — main client dashboard. Polls `/api/applications` every 30 seconds and renders filters, search, status updates, edit UI, CSV export, and rejection matching.
- [src/app/page.tsx](src/app/page.tsx) — page wrapper; uses `dynamic = "force-dynamic"`.

### Backend Routes

All routes live under `src/app/api/`:

- [src/app/api/applications/route.ts](src/app/api/applications/route.ts) — `GET` reads all applications from Sheets and `POST` adds a manual application.
- [src/app/api/applications/[id]/route.ts](src/app/api/applications/[id]/route.ts) — `PATCH` and `DELETE` for a single record.
- [src/app/api/applications/upsert/route.ts](src/app/api/applications/upsert/route.ts) — idempotent bulk write endpoint used by sync jobs. Deduplicates by `gmailThreadId` first, then `emailSubject + emailDate`.
- [src/app/api/sync/route.ts](src/app/api/sync/route.ts) — scheduled sync endpoint. Reads Gmail, extracts applications with Gemini, and posts them to `/api/applications/upsert`.
- [src/app/api/bulk-sync/route.ts](src/app/api/bulk-sync/route.ts) — local-only historical backfill route. Not intended for Cloud Run.

### Google Sheets Layer

- [src/lib/sheets.ts](src/lib/sheets.ts) — authenticated Google Sheets client.
- `ensureHeaderRow()` creates or repairs the header row.
- `listApplications()` reads the sheet into typed `Application` objects.
- `appendApplication()` and `updateApplication()` are the write path used by the API.
- `deleteApplication()` deletes a row by `id`.

### Data Model

- [src/lib/types.ts](src/lib/types.ts) defines the `Application` schema and sheet column order.
- Current sheet width is `A:O` with 15 fields, including `easyApply` and `gmailThreadId`.

## Scheduler and Sync

### Supported Scheduler

- [CREATE_SCHEDULER.sh](CREATE_SCHEDULER.sh) creates a Google Cloud Scheduler job.
- The job calls `POST /api/sync` every 15 minutes.
- If `SYNC_SHARED_SECRET` is set, the scheduler must send `X-Sync-Secret: <secret>`. Cloud Scheduler's OIDC token stays on `Authorization`.

### What `/api/sync` Does

1. Searches Gmail for recent job-related threads.
2. Fetches the latest message in each thread.
3. Skips blacklisted senders and non-job emails.
4. Sends the message body to Gemini with the extraction prompt.
5. Adds `emailSubject`, `emailDate`, and `gmailThreadId`.
6. Posts the extracted records to `/api/applications/upsert`.
7. `/api/applications/upsert` either updates an existing sheet row or appends a new one.

Scheduled sync also maintains a small cursor/state record in a `SyncState` tab so it can page through Gmail results across runs and skip already-imported `gmailThreadId`s instead of reprocessing only the top page forever.

### Important Production Detail

Cloud Run sync requires Gmail OAuth env vars:

- `GMAIL_REFRESH_TOKEN`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`

If these are missing in Cloud Run, scheduler-triggered sync will fail even if local bulk sync worked.

`DASHBOARD_BASE_URL` is still useful for local scripts, but the deployed `/api/sync` route can now fall back to the incoming request origin so Cloud Run does not depend on a stale localhost URL.

### Bulk Sync vs Scheduler

- `bulk-sync` is for one-time local backfill.
- Bulk sync writing rows successfully does **not** prove the deployed scheduler path is healthy.
- The scheduler path has separate runtime requirements: deployed env vars, Cloud Scheduler auth, and Cloud Run logs.

## Environment Variables

Required:

- `GOOGLE_SHEETS_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_KEY`
- `GEMINI_API_KEY`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`

Usually set for local tooling:

- `DASHBOARD_BASE_URL`

Optional:

- `SYNC_SHARED_SECRET`

Copy `.env.example` to `.env.local` and restart the dev server after changes.

## Deployment

- [deploy.sh](deploy.sh) deploys to Cloud Run and now passes the Gmail OAuth env vars needed by `/api/sync`.
- Localhost `DASHBOARD_BASE_URL` values should not be deployed; the sync route can derive its own public origin when invoked in Cloud Run.
- After deploy, run [CREATE_SCHEDULER.sh](CREATE_SCHEDULER.sh) to recreate the scheduler job if needed.

## Known Constraints

1. Next.js 16 has breaking changes compared with older examples. Read the relevant docs in `node_modules/next/dist/docs/` before changing framework-sensitive code.
2. React Compiler is enabled, so avoid patterns that fight compiler assumptions.
3. Gemini quota is limited; `/api/sync` intentionally rate-limits and may stop early on `429`.
4. Sync only scans matching Gmail threads from the configured lookback window.
5. Bulk sync is local-only and can run much longer than Cloud Run request limits.

## Testing Flows

### Dashboard

1. Run `npm run dev`.
2. Open `http://localhost:3000`.
3. Add or edit an application.
4. Confirm the row appears in the Google Sheet.

### Local Sync

```bash
GOOGLE_SHEETS_ID=... \
GOOGLE_SERVICE_ACCOUNT_EMAIL=... \
GOOGLE_SERVICE_ACCOUNT_KEY="..." \
GEMINI_API_KEY=... \
GMAIL_REFRESH_TOKEN=... \
GMAIL_CLIENT_ID=... \
GMAIL_CLIENT_SECRET=... \
DASHBOARD_BASE_URL=http://localhost:3000 \
npm run sync
```

### Production Scheduler

1. Deploy with `./deploy.sh`.
2. Create or refresh the scheduler with `./CREATE_SCHEDULER.sh`.
3. Manually run the job once with `gcloud scheduler jobs run jobtracker-sync --location=us-central1`.
4. Inspect Cloud Run logs.

## Debugging Tips

- Missing Gmail OAuth env vars in Cloud Run will break `/api/sync`.
- A localhost `DASHBOARD_BASE_URL` in production is wrong for Cloud Run.
- `SYNC_SHARED_SECRET` must match between Cloud Scheduler and the deployed service. Scheduler sends it in `X-Sync-Secret`.
- If rows exist from bulk sync but later statuses do not update, check whether the scheduler job is actually reaching `/api/sync` and whether Cloud Run can read Gmail.
- If the dashboard is stale, remember it polls every 30 seconds unless manually refreshed.
