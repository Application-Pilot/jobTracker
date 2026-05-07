import { google } from 'googleapis';
import axios from 'axios';
import { listApplications, ensureHeaderRow } from '@/lib/sheets';
import { localDateString } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bulk-sync is designed to run LOCALLY (npm run dev) for one-time backfill of
// historical job emails. It can run for tens of minutes, which exceeds Cloud
// Run's 5-minute request timeout — do NOT deploy this endpoint to Cloud Run.

const KEYWORD_QUERY = 'newer_than:90d (subject:(application OR applied OR offer OR interview OR rejection OR "thank you for applying" OR "next steps" OR "we regret" OR "unfortunately" OR "moving forward") OR "job application" OR "we received your application" OR "interview" OR "we are excited" OR "your application")';
const GEMINI_MODEL = 'gemini-flash-latest';
const REQUEST_DELAY_MS = 6000;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const BULK_BATCH_SIZE = 10;
const SENDER_BLACKLIST = ['micro1', 'jobgether'];

function isBlacklisted(from: string): string | null {
  const lower = from.toLowerCase();
  for (const term of SENDER_BLACKLIST) {
    if (lower.includes(term)) return term;
  }
  return null;
}

const EXTRACTION_PROMPT = `You analyze a single email message and extract structured info about a job application.
If the email is NOT about a job application, offer, interview, or rejection, respond with
exactly the literal string SKIP and nothing else.

Otherwise return a JSON object with these fields (strings, empty string when unknown):
  jobTitle         — role title, e.g. "Senior Backend Engineer"
  company          — hiring company name
  appliedDate      — YYYY-MM-DD if explicitly stated, else empty
  status           — one of: pending | interview | accepted | rejected
  interviewDate    — YYYY-MM-DD if scheduled, else empty
  rejectionReason  — short reason if rejection, else empty
  jobLink          — a job posting URL found in the email, else empty
  salaryRange      — exact salary text if present, else empty
  location         — city/remote/hybrid info if present, else empty
  easyApply        — "true" if the email is a LinkedIn Easy Apply confirmation
                     (sender contains "linkedin.com" AND subject/body indicates
                     "your application was sent to" / "applied via LinkedIn" /
                     "Easy Apply"), else empty string

Return ONLY the JSON object — no markdown fences, no commentary.`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEmailDate(rawDate: string): string {
  if (!rawDate) return '';
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return '';
  return localDateString(d);
}

async function getGmailClient() {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('Missing GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, or GMAIL_CLIENT_SECRET');
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'http://localhost:3000/auth/callback',
  );

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function listAllThreadIds(gmail: any): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let page = 0;
  do {
    page++;
    const res = await gmail.users.threads.list({
      userId: 'me',
      q: KEYWORD_QUERY,
      maxResults: 500,
      pageToken,
    });
    const threads = res.data.threads || [];
    for (const t of threads) if (t.id) ids.push(t.id);
    console.log(`  page ${page}: +${threads.length} (total ${ids.length})`);
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return ids;
}

async function getThreadHeaders(gmail: any, threadId: string) {
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'Date'],
  });
  const messages = thread.data.messages || [];
  if (messages.length === 0) return null;
  const msg = messages[messages.length - 1];
  const headers = msg.payload?.headers || [];
  const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
  const from = headers.find((h: any) => h.name === 'From')?.value || '';
  const date = headers.find((h: any) => h.name === 'Date')?.value || '';
  return { subject, from, date };
}

async function getThreadBody(gmail: any, threadId: string) {
  const thread = await gmail.users.threads.get({ userId: 'me', id: threadId });
  const messages = thread.data.messages || [];
  if (messages.length === 0) return null;
  const msg = messages[messages.length - 1];
  const headers = msg.payload?.headers || [];
  const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
  const from = headers.find((h: any) => h.name === 'From')?.value || '';
  const date = headers.find((h: any) => h.name === 'Date')?.value || '';

  let body = '';
  if (msg.payload?.parts) {
    const textPart = msg.payload.parts.find((p: any) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }
  } else if (msg.payload?.body?.data) {
    body = Buffer.from(msg.payload.body.data, 'base64').toString('utf-8');
  }
  body = body.slice(0, 8000);
  return { subject, from, date, body };
}

async function callGemini(msg: { subject: string; from: string; date: string; body: string }) {
  const userPart = `Subject: ${msg.subject}\nFrom: ${msg.from}\nDate: ${msg.date}\n\n${msg.body}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY!)}`;
  const res = await axios.post(url, {
    contents: [{ role: 'user', parts: [{ text: EXTRACTION_PROMPT + '\n\n---\n' + userPart }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  });
  const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text || text.trim() === 'SKIP') return null;
  const parsed = JSON.parse(text.trim());
  if (!parsed.jobTitle || !parsed.company) return null;
  return parsed;
}

type ExtractResult =
  | { kind: 'app'; data: any }
  | { kind: 'skip' }
  | { kind: 'error'; message: string };

async function extractWithRetry(
  msg: { subject: string; from: string; date: string; body: string },
): Promise<ExtractResult> {
  let attempt = 0;
  while (attempt <= MAX_RATE_LIMIT_RETRIES) {
    try {
      const data = await callGemini(msg);
      return data ? { kind: 'app', data } : { kind: 'skip' };
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 429) {
        attempt++;
        if (attempt > MAX_RATE_LIMIT_RETRIES) {
          return { kind: 'error', message: '429 after retries' };
        }
        console.log(`  ⏸ 429 hit, sleeping ${RATE_LIMIT_BACKOFF_MS / 1000}s (retry ${attempt}/${MAX_RATE_LIMIT_RETRIES})`);
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      return { kind: 'error', message: err.message || 'unknown' };
    }
  }
  return { kind: 'error', message: 'exhausted retries' };
}

async function flushBatch(apps: any[]): Promise<{ ok: boolean; message?: string }> {
  if (apps.length === 0) return { ok: true };
  const baseUrl = process.env.DASHBOARD_BASE_URL || 'http://localhost:3000';
  const headers: any = { 'Content-Type': 'application/json' };
  if (process.env.SYNC_SHARED_SECRET) {
    headers['Authorization'] = 'Bearer ' + process.env.SYNC_SHARED_SECRET;
  }
  try {
    const res = await axios.post(baseUrl + '/api/applications/upsert', { applications: apps }, { headers });
    console.log(`  ✓ flushed ${apps.length}: ${JSON.stringify(res.data)}`);
    return { ok: true };
  } catch (err: any) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('  ✗ flush failed: ' + detail);
    return { ok: false, message: detail };
  }
}

export async function POST(req: Request) {
  const secret = process.env.SYNC_SHARED_SECRET;
  if (secret) {
    const authHeader = req.headers.get('authorization') || '';
    if (authHeader !== `Bearer ${secret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'Missing GEMINI_API_KEY' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const startTime = Date.now();
  const summary = {
    totalThreads: 0,
    alreadySynced: 0,
    extracted: 0,
    skippedNonJob: 0,
    blacklisted: 0,
    errored: 0,
    flushBatches: 0,
  };

  try {
    console.log('=== Bulk Sync Start ===');
    await ensureHeaderRow();

    console.log('Building skip-set from sheet...');
    const existing = await listApplications();
    const skipThreadIds = new Set<string>();
    const skipSubjectDate = new Set<string>();
    for (const a of existing) {
      if (a.gmailThreadId) skipThreadIds.add(a.gmailThreadId);
      if (a.emailSubject) {
        skipSubjectDate.add(`${a.emailSubject.toLowerCase()}|${a.emailDate}`);
      }
    }
    console.log(`  ${skipThreadIds.size} threadIds, ${skipSubjectDate.size} subject+date keys`);

    const gmail = await getGmailClient();
    console.log('Listing all threads (paginated)...');
    const threadIds = await listAllThreadIds(gmail);
    summary.totalThreads = threadIds.length;
    console.log(`Total threads: ${threadIds.length}\n`);

    const batch: any[] = [];

    for (let i = 0; i < threadIds.length; i++) {
      const threadId = threadIds[i];
      const prefix = `[${i + 1}/${threadIds.length}]`;

      if (skipThreadIds.has(threadId)) {
        summary.alreadySynced++;
        console.log(`${prefix} ⊝ already synced (threadId match)`);
        continue;
      }

      const meta = await getThreadHeaders(gmail, threadId);
      if (!meta) {
        console.log(`${prefix} no metadata, skipping`);
        continue;
      }
      const dateKey = parseEmailDate(meta.date);
      const subjectShort = meta.subject.slice(0, 70);
      const fromShort = meta.from.slice(0, 50);
      console.log(`${prefix} ${dateKey} | from: ${fromShort}`);
      console.log(`        subject: ${subjectShort}`);

      const subjectKey = `${meta.subject.toLowerCase()}|${dateKey}`;
      if (skipSubjectDate.has(subjectKey)) {
        summary.alreadySynced++;
        console.log(`        ⊝ already synced (subject+date match)`);
        skipThreadIds.add(threadId);
        continue;
      }

      const blacklistHit = isBlacklisted(meta.from);
      if (blacklistHit) {
        summary.blacklisted++;
        console.log(`        ⊘ blacklisted sender (${blacklistHit})`);
        continue;
      }

      const full = await getThreadBody(gmail, threadId);
      if (!full) {
        console.log(`        ✗ no body, skipping`);
        continue;
      }

      const t0 = Date.now();
      const result = await extractWithRetry(full);
      const dt = Math.round((Date.now() - t0) / 100) / 10;

      if (result.kind === 'skip') {
        summary.skippedNonJob++;
        console.log(`        → SKIP non-job (${dt}s)`);
      } else if (result.kind === 'error') {
        summary.errored++;
        console.log(`        ✗ ERROR: ${result.message} (${dt}s)`);
      } else {
        const app = result.data;
        app.emailSubject = full.subject;
        app.emailDate = dateKey;
        app.gmailThreadId = threadId;
        const flag = app.easyApply === 'true' ? ' [easyApply]' : '';
        console.log(`        ✓ ${app.jobTitle} @ ${app.company} [${app.status}]${flag} (${dt}s)`);
        batch.push(app);
        skipThreadIds.add(threadId);
        skipSubjectDate.add(subjectKey);
        summary.extracted++;
      }

      if (batch.length >= BULK_BATCH_SIZE) {
        const flush = await flushBatch(batch);
        summary.flushBatches++;
        if (!flush.ok) {
          summary.errored += batch.length;
        }
        batch.length = 0;
      }

      await sleep(REQUEST_DELAY_MS);
    }

    if (batch.length > 0) {
      const flush = await flushBatch(batch);
      summary.flushBatches++;
      if (!flush.ok) summary.errored += batch.length;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n=== Bulk Sync Done in ${elapsed}s ===`);
    console.log(JSON.stringify(summary, null, 2));

    return new Response(
      JSON.stringify({ success: true, elapsedSec: elapsed, ...summary }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('Bulk sync failed:', err.message);
    return new Response(
      JSON.stringify({ error: err.message, partial: summary }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
