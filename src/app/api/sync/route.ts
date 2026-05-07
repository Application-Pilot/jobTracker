import { google } from 'googleapis';
import axios from 'axios';
import {
  ensureHeaderRow,
  ensureSyncStateSheet,
  listApplications,
  readJsonState,
  writeJsonState,
} from '@/lib/sheets';
import { localDateString } from '@/lib/types';

export const runtime = 'nodejs';

const KEYWORD_QUERY = 'newer_than:14d (subject:(application OR applied OR offer OR interview OR rejection OR "thank you for applying" OR "next steps" OR "we regret" OR "unfortunately" OR "moving forward") OR "job application" OR "we received your application" OR "interview" OR "we are excited" OR "your application")';
const GEMINI_MODEL = 'gemini-flash-latest';
const MAX_THREADS_PER_RUN = 15;
const REQUEST_DELAY_MS = 8000;
const GMAIL_PAGE_SIZE = 100;
const MAX_PAGES_PER_RUN = 5;
const SENDER_BLACKLIST = ['micro1', 'jobgether'];
const SYNC_STATE_KEY = 'api-sync-v1';

type ScheduledSyncState = {
  resumePageToken: string;
  lastProcessedThreadId: string;
  lastProcessedThreadDate: string;
  lastRunStartedAt: string;
  lastRunCompletedAt: string;
  lastCycleCompletedAt: string;
};

type ThreadCandidate = {
  threadId: string;
  subject: string;
  from: string;
  date: string;
  dateKey: string;
  subjectKey: string;
};

function isBlacklistedFrom(from: string): string | null {
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

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    'http://localhost:3000/auth/callback'
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

async function listThreadPage(gmail: any, pageToken?: string) {
  return gmail.users.threads.list({
    userId: 'me',
    q: KEYWORD_QUERY,
    maxResults: GMAIL_PAGE_SIZE,
    pageToken,
  });
}

function isInvalidPageTokenError(err: any): boolean {
  const status = err?.response?.status;
  const message = String(err?.message || '').toLowerCase();
  return status === 400 && message.includes('page');
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

async function getMessageBody(gmail: any, threadId: string) {
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
  });

  const messages = thread.data.messages || [];
  if (messages.length === 0) return null;

  const msg = messages[messages.length - 1];
  const headers = msg.payload.headers || [];
  const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
  const from = headers.find((h: any) => h.name === 'From')?.value || '';
  const date = headers.find((h: any) => h.name === 'Date')?.value || '';

  let body = '';
  if (msg.payload.parts) {
    const textPart = msg.payload.parts.find((p: any) => p.mimeType === 'text/plain');
    if (textPart && textPart.body?.data) {
      body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }
  } else if (msg.payload.body?.data) {
    body = Buffer.from(msg.payload.body.data, 'base64').toString('utf-8');
  }

  body = body.slice(0, 8000);
  return { subject, from, date, body };
}

async function extractWithGemini(msg: any) {
  const userPart = `Subject: ${msg.subject}
From: ${msg.from}
Date: ${msg.date}

${msg.body}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY!)}`;

  try {
    const res = await axios.post(url, {
      contents: [
        {
          role: 'user',
          parts: [{ text: EXTRACTION_PROMPT + '\n\n---\n' + userPart }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    });

    const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text || text.trim() === 'SKIP') {
      console.log('  → SKIP');
      return null;
    }

    const parsed = JSON.parse(text.trim());
    if (!parsed.jobTitle || !parsed.company) {
      console.log('  → Missing jobTitle or company');
      return null;
    }

    console.log('  → ' + parsed.jobTitle + ' at ' + parsed.company);
    return parsed;
  } catch (err: any) {
    if (err.response?.status === 429) {
      console.log('  → QUOTA HIT');
      return 'QUOTA';
    }
    console.error('  → Gemini error: ' + err.message);
    return null;
  }
}

async function collectThreadCandidates(
  gmail: any,
  {
    startPageToken,
    maxCandidates,
    skipThreadIds,
    skipSubjectDate,
  }: {
    startPageToken?: string;
    maxCandidates: number;
    skipThreadIds: Set<string>;
    skipSubjectDate: Set<string>;
  },
) {
  const candidates: ThreadCandidate[] = [];
  const seenThreadIds = new Set<string>();
  let pageToken = startPageToken || undefined;
  let scannedPages = 0;
  let wrappedToStart = !startPageToken;
  let cycleCompleted = false;

  while (candidates.length < maxCandidates && scannedPages < MAX_PAGES_PER_RUN) {
    const tokenForThisPage = pageToken || '';
    let res: any;
    try {
      res = await listThreadPage(gmail, pageToken);
    } catch (err: any) {
      if (pageToken && isInvalidPageTokenError(err)) {
        console.log('Stored Gmail page token is invalid; restarting from newest results');
        pageToken = undefined;
        wrappedToStart = true;
        cycleCompleted = true;
        continue;
      }
      throw err;
    }

    scannedPages++;
    const threads = res.data.threads || [];
    const nextPageToken = res.data.nextPageToken || '';

    if (threads.length === 0) {
      if (pageToken && !wrappedToStart) {
        console.log('Reached end of Gmail results from stored cursor; wrapping to newest page');
        pageToken = undefined;
        wrappedToStart = true;
        cycleCompleted = true;
        continue;
      }
      return {
        candidates,
        resumePageToken: '',
        cycleCompleted: true,
      };
    }

    let skippedByThreadId = 0;
    let skippedBySubjectDate = 0;
    let skippedBlacklisted = 0;
    let skippedNoMeta = 0;
    let stoppedMidPage = false;

    for (const thread of threads) {
      const threadId = thread.id;
      if (!threadId || seenThreadIds.has(threadId)) continue;
      seenThreadIds.add(threadId);

      if (skipThreadIds.has(threadId)) {
        skippedByThreadId++;
        continue;
      }

      const meta = await getThreadHeaders(gmail, threadId);
      if (!meta) {
        skippedNoMeta++;
        continue;
      }

      const dateKey = parseEmailDate(meta.date);
      const subjectKey = `${meta.subject.toLowerCase()}|${dateKey}`;
      if (skipSubjectDate.has(subjectKey)) {
        skipThreadIds.add(threadId);
        skippedBySubjectDate++;
        continue;
      }

      const blacklistHit = isBlacklistedFrom(meta.from);
      if (blacklistHit) {
        skippedBlacklisted++;
        continue;
      }

      candidates.push({
        threadId,
        subject: meta.subject,
        from: meta.from,
        date: meta.date,
        dateKey,
        subjectKey,
      });

      if (candidates.length >= maxCandidates) {
        stoppedMidPage = true;
        break;
      }
    }

    console.log(
      `Scanned Gmail page ${scannedPages}: ${threads.length} threads, ` +
        `${candidates.length}/${maxCandidates} candidates, ` +
        `${skippedByThreadId} threadId skips, ${skippedBySubjectDate} subject/date skips, ` +
        `${skippedBlacklisted} blacklisted, ${skippedNoMeta} no-metadata`,
    );

    if (stoppedMidPage) {
      return {
        candidates,
        resumePageToken: tokenForThisPage,
        cycleCompleted,
      };
    }

    if (nextPageToken) {
      pageToken = nextPageToken;
      continue;
    }

    if (!wrappedToStart) {
      console.log('Exhausted older Gmail pages; wrapping to newest page to continue this run');
      pageToken = undefined;
      wrappedToStart = true;
      cycleCompleted = true;
      continue;
    }

    return {
      candidates,
      resumePageToken: '',
      cycleCompleted: true,
    };
  }

  return {
    candidates,
    resumePageToken: pageToken || '',
    cycleCompleted,
  };
}

function resolveDashboardBaseUrl(req?: Request) {
  const configured = process.env.DASHBOARD_BASE_URL?.trim();
  const isLocalConfigured =
    !!configured &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(configured);

  if (configured && !isLocalConfigured) {
    return configured.replace(/\/$/, '');
  }

  const forwardedHost = req?.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = req?.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedHost) {
    const proto = forwardedProto || 'https';
    return `${proto}://${forwardedHost}`.replace(/\/$/, '');
  }

  const host = req?.headers.get('host')?.trim();
  if (host && !/^(0\.0\.0\.0|localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    const proto = forwardedProto || 'https';
    return `${proto}://${host}`.replace(/\/$/, '');
  }

  if (req?.url) {
    const origin = new URL(req.url).origin;
    if (!/^https?:\/\/(0\.0\.0\.0|localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(origin)) {
      return origin.replace(/\/$/, '');
    }
  }

  if (configured) {
    return configured.replace(/\/$/, '');
  }

  throw new Error('Missing DASHBOARD_BASE_URL');
}

async function upsertApplications(apps: any[], req?: Request): Promise<boolean> {
  if (apps.length === 0) {
    console.log('No applications to upsert');
    return true;
  }

  const baseUrl = resolveDashboardBaseUrl(req);

  const headers: any = { 'Content-Type': 'application/json' };
  if (process.env.SYNC_SHARED_SECRET) {
    headers['Authorization'] = 'Bearer ' + process.env.SYNC_SHARED_SECRET;
  }

  try {
    const res = await axios.post(baseUrl + '/api/applications/upsert', {
      applications: apps,
    }, { headers });

    console.log('Upsert response: ' + res.status + ' ' + JSON.stringify(res.data));
    return true;
  } catch (err: any) {
    console.error('Upsert failed: ' + err.message);
    return false;
  }
}

async function runSync(req?: Request) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY');
  }
  if (
    !process.env.GMAIL_REFRESH_TOKEN ||
    !process.env.GMAIL_CLIENT_ID ||
    !process.env.GMAIL_CLIENT_SECRET
  ) {
    throw new Error('Missing GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, or GMAIL_CLIENT_SECRET');
  }

  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  console.log('Starting sync...');
  console.log('Upsert target: ' + resolveDashboardBaseUrl(req));
  await ensureHeaderRow();
  await ensureSyncStateSheet();

  const state = await readJsonState<ScheduledSyncState>(SYNC_STATE_KEY, {
    resumePageToken: '',
    lastProcessedThreadId: '',
    lastProcessedThreadDate: '',
    lastRunStartedAt: '',
    lastRunCompletedAt: '',
    lastCycleCompletedAt: '',
  });

  const existing = await listApplications();
  const skipThreadIds = new Set<string>();
  const skipSubjectDate = new Set<string>();
  for (const app of existing) {
    if (app.gmailThreadId) skipThreadIds.add(app.gmailThreadId);
    if (app.emailSubject) {
      skipSubjectDate.add(`${app.emailSubject.toLowerCase()}|${app.emailDate}`);
    }
  }
  console.log(
    `Built skip-set from sheet: ${skipThreadIds.size} threadIds, ` +
      `${skipSubjectDate.size} subject/date keys`,
  );

  const gmail = await getGmailClient();
  const { candidates, resumePageToken, cycleCompleted } = await collectThreadCandidates(
    gmail,
    {
      startPageToken: state.resumePageToken || undefined,
      maxCandidates: MAX_THREADS_PER_RUN,
      skipThreadIds,
      skipSubjectDate,
    },
  );
  if (candidates.length === 0) {
    console.log('No unsynced Gmail threads matched this run');
    await writeJsonState<ScheduledSyncState>(SYNC_STATE_KEY, {
      ...state,
      resumePageToken,
      lastRunStartedAt: startedAt,
      lastRunCompletedAt: new Date().toISOString(),
      lastCycleCompletedAt: cycleCompleted
        ? new Date().toISOString()
        : state.lastCycleCompletedAt,
    });
    return [];
  }

  console.log(
    `Processing ${candidates.length} unsynced threads this run ` +
      `(cursor ${state.resumePageToken ? 'resume' : 'start'} -> ${resumePageToken || 'start'})\n`,
  );

  const apps: any[] = [];
  let quotaHit = false;
  let lastProcessedCandidate: ThreadCandidate | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed > 300) {
      console.log('\nStopping early: approaching timeout (' + elapsed + 's)');
      break;
    }

    const candidate = candidates[i];
    console.log((i + 1) + '/' + candidates.length + ' ' + candidate.threadId);
    lastProcessedCandidate = candidate;
    const msg = await getMessageBody(gmail, candidate.threadId);
    if (!msg) continue;

    const blacklistHit = isBlacklistedFrom(msg.from);
    if (blacklistHit) {
      console.log('  ⊘ blacklisted sender (' + blacklistHit + ')');
      continue;
    }

    const result = await extractWithGemini(msg);
    if (result === 'QUOTA') {
      quotaHit = true;
      break;
    }

    if (result) {
      result.emailSubject = msg.subject;
      result.emailDate = candidate.dateKey || localDateString(new Date(msg.date));
      result.gmailThreadId = candidate.threadId;
      apps.push(result);
    }

    if (i < candidates.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log('\nExtracted ' + apps.length + ' applications');
  if (quotaHit) console.log('(stopped early: quota hit)');

  const processedAllCandidates =
    !quotaHit &&
    !!lastProcessedCandidate &&
    lastProcessedCandidate.threadId === candidates[candidates.length - 1].threadId;
  const upsertSucceeded = await upsertApplications(apps, req);

  await writeJsonState<ScheduledSyncState>(SYNC_STATE_KEY, {
    resumePageToken:
      processedAllCandidates && upsertSucceeded
        ? resumePageToken
        : state.resumePageToken,
    lastProcessedThreadId:
      lastProcessedCandidate?.threadId || state.lastProcessedThreadId,
    lastProcessedThreadDate:
      lastProcessedCandidate?.dateKey || state.lastProcessedThreadDate,
    lastRunStartedAt: startedAt,
    lastRunCompletedAt: new Date().toISOString(),
    lastCycleCompletedAt:
      processedAllCandidates && upsertSucceeded && cycleCompleted
        ? new Date().toISOString()
        : state.lastCycleCompletedAt,
  });

  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log('\nSync completed in ' + totalTime + 's');

  return apps;
}

export async function POST(req: Request) {
  // Optional auth check: if SYNC_SHARED_SECRET is set, require it in either
  // Authorization: Bearer <secret> or X-Sync-Secret: <secret>.
  const secret = process.env.SYNC_SHARED_SECRET;
  if (secret) {
    const authHeader = req.headers.get('authorization') || '';
    const syncSecretHeader = req.headers.get('x-sync-secret') || '';
    const authOk = authHeader === `Bearer ${secret}`;
    const syncSecretOk = syncSecretHeader === secret;
    if (!authOk && !syncSecretOk) {
      console.log('Auth failed: missing valid scheduler secret');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    console.log('Sync request authorized');
    const apps = await runSync(req);
    return new Response(JSON.stringify({ success: true, extracted: apps.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Sync failed:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
