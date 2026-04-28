# Job Application Tracker

A personal dashboard that tracks job applications. Gmail messages are parsed
by Gemini in a Google Apps Script, written to a Google Sheet, and surfaced in
a Next.js dashboard with status filters, search, sort, manual entry/edit, and
"similar still-open roles" suggestions on rejected applications.

```
Gmail → Apps Script (Gemini extraction) → /api/applications/upsert → Google Sheet
                                                                       ↓
                                                                Next.js Dashboard
```

## What lives where

- `src/app/Dashboard.tsx` — the dashboard UI (client component).
- `src/app/api/applications/*` — REST endpoints over the Sheet.
- `src/lib/sheets.ts` — service-account-auth Google Sheets v4 client.
- `src/lib/types.ts` — schema + sheet header order.
- `src/lib/match.ts` — rejection similarity scoring.
- `apps-script/` — paste these into a Google Apps Script project bound to
  your Sheet. Handles Gmail reading + Gemini extraction + daily trigger.

## One-time setup

### 1. Create the Google Sheet

1. Create a new Google Sheet named **Job Applications**.
2. Rename the first tab to `Applications` (case-sensitive).
3. Copy the spreadsheet ID from the URL — it's the part between `/d/` and
   `/edit`. You'll use this as `GOOGLE_SHEETS_ID`.

The dashboard auto-creates the header row on first load, so you don't need
to populate columns manually.

### 2. Create a Google Cloud project + service account

1. Go to <https://console.cloud.google.com>, create a new project (e.g. "jobtracker").
2. **APIs & Services → Library**, enable **Google Sheets API**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   Name it anything (e.g. `jobtracker-sheets`). Skip the optional steps.
4. Open the service account, **Keys → Add key → Create new key → JSON**.
   A `.json` file downloads. Keep it secret.
5. Open your Sheet, click **Share**, and share it with the service
   account's email (`...iam.gserviceaccount.com`) as **Editor**.

### 3. Configure environment variables

Copy `.env.example` to `.env.local` and fill it in:

```
GOOGLE_SHEETS_ID=...                       # from step 1
GOOGLE_SERVICE_ACCOUNT_EMAIL=...           # client_email from the JSON
GOOGLE_SERVICE_ACCOUNT_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
SYNC_SHARED_SECRET=                        # optional, any random string
```

For the private key, paste the entire `private_key` value from the JSON —
keep it as one line with literal `\n` escapes, wrapped in double quotes.

### 4. Run the dashboard

```bash
npm run dev
```

Open <http://localhost:3000>. You should see an empty dashboard. Click **+ Add**
to make sure write access works — it will land in your Sheet immediately.

### 5. Set up the Gmail → Sheet automation

1. Open your Sheet, **Extensions → Apps Script**.
2. Delete the default `Code.gs` and paste the contents of
   [apps-script/Code.gs](apps-script/Code.gs).
3. In the Apps Script editor, click the gear (Project Settings), check
   **Show "appsscript.json" manifest**, then replace its contents with
   [apps-script/appsscript.json](apps-script/appsscript.json).
4. **Project Settings → Script properties → Add script property** for each:
   - `GEMINI_API_KEY` — your Gemini API key (rotate if it has been shared in chat).
   - `DASHBOARD_BASE_URL` — `https://your-app.vercel.app` (or your dev tunnel for testing).
   - `SYNC_SHARED_SECRET` — same value as the dashboard's env var (optional but recommended in prod).
   - `LOOKBACK_DAYS` — defaults to `14`.
5. Run the function `syncNow` once. Authorize Gmail + external requests when prompted.
   Check **Executions** for logs.
6. Run `installDailyTrigger` once to schedule the 9am sync.

The upsert endpoint deduplicates by `emailSubject + emailDate`, so re-running
`syncNow` won't create duplicates.

## Deploy

```bash
npx vercel
```

Set the same env vars in the Vercel project settings. Update the Apps
Script's `DASHBOARD_BASE_URL` to the deployed URL.

## Useful behaviors

- **Auto-refresh:** dashboard polls the API every 30 seconds.
- **Filters:** the count cards at the top double as filter buttons.
- **Quick status:** every card has one-click `→ pending / interview / accepted / rejected` buttons.
- **Rejection matching:** when a card is rejected, the dashboard shows up
  to 5 still-open applications with similar titles, same company, or same
  location.
- **CSV export:** "Export CSV" button downloads the current full dataset.

## Troubleshooting

- **"Missing GOOGLE_SHEETS_ID"** etc. — your `.env.local` isn't being read.
  Restart `npm run dev` after editing it.
- **403 from Sheets API** — you didn't share the Sheet with the service
  account email, or the tab isn't named `Applications`.
- **Apps Script can't reach the dashboard** — `DASHBOARD_BASE_URL` must be
  publicly reachable. `localhost` won't work; use a Vercel preview or a
  tunnel like `cloudflared`.
- **Gemini returns nothing useful** — the prompt asks the model to return
  `SKIP` for non-job emails. Check the Apps Script execution log to see
  what it returned.
