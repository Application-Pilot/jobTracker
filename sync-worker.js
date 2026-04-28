#!/usr/bin/env node
/**
 * Job Application Tracker — Gmail sync worker for Cloud Run.
 * Replaces the Apps Script version with more reliable execution.
 *
 * Usage:
 *   node sync-worker.js
 *
 * Environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_KEY (PEM format, can include literal \n)
 *   GOOGLE_SHEETS_ID
 *   GEMINI_API_KEY
 *   DASHBOARD_BASE_URL
 *   SYNC_SHARED_SECRET (optional)
 */

const { google } = require('googleapis');
const axios = require('axios');

const KEYWORD_QUERY = 'newer_than:14d (subject:(application OR applied OR offer OR interview OR rejection OR "thank you for applying" OR "next steps" OR "we regret" OR "unfortunately" OR "moving forward") OR "job application" OR "we received your application" OR "interview" OR "we are excited" OR "your application")';

const GEMINI_MODEL = 'gemini-flash-latest';
const MAX_THREADS_PER_RUN = 10;
const REQUEST_DELAY_MS = 10000;
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

Return ONLY the JSON object — no markdown fences, no commentary.`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getGmailClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

  if (!email || !key) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY');
  }

  const keyObj = {
    type: 'service_account',
    project_id: email.split('@')[1].split('.')[0],
    private_key_id: 'key1',
    private_key: key.replace(/\\n/g, '\n'),
    client_email: email,
    client_id: '1',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  };

  const auth = new google.auth.GoogleAuth({
    credentials: keyObj,
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  });

  return google.gmail({ version: 'v1', auth });
}

async function getGmailThreads() {
  const gmail = await getGmailClient();
  console.log('Searching Gmail for: ' + KEYWORD_QUERY);

  const res = await gmail.users.threads.list({
    userId: 'me',
    q: KEYWORD_QUERY,
    maxResults: 100,
  });

  console.log('Found ' + (res.data.threads?.length || 0) + ' threads');
  return res.data.threads || [];
}

async function getMessageBody(gmail, threadId) {
  const thread = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
  });

  const messages = thread.data.messages || [];
  if (messages.length === 0) return null;

  const msg = messages[messages.length - 1];
  const headers = msg.payload.headers || [];
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const date = headers.find(h => h.name === 'Date')?.value || '';

  let body = '';
  if (msg.payload.parts) {
    const textPart = msg.payload.parts.find(p => p.mimeType === 'text/plain');
    if (textPart && textPart.body?.data) {
      body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }
  } else if (msg.payload.body?.data) {
    body = Buffer.from(msg.payload.body.data, 'base64').toString('utf-8');
  }

  body = body.slice(0, 8000);
  return { subject, from, date, body };
}

async function extractWithGemini(msg) {
  const userPart = `Subject: ${msg.subject}
From: ${msg.from}
Date: ${msg.date}

${msg.body}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

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
  } catch (err) {
    if (err.response?.status === 429) {
      console.log('  → QUOTA HIT');
      return 'QUOTA';
    }
    console.error('  → Gemini error: ' + err.message);
    return null;
  }
}

async function upsertApplications(apps) {
  if (apps.length === 0) {
    console.log('No applications to upsert');
    return;
  }

  const baseUrl = process.env.DASHBOARD_BASE_URL;
  if (!baseUrl) {
    console.error('Missing DASHBOARD_BASE_URL');
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.SYNC_SHARED_SECRET) {
    headers['Authorization'] = 'Bearer ' + process.env.SYNC_SHARED_SECRET;
  }

  try {
    const res = await axios.post(baseUrl + '/api/applications/upsert', {
      applications: apps,
    }, { headers });

    console.log('Upsert response: ' + res.status + ' ' + JSON.stringify(res.data));
  } catch (err) {
    console.error('Upsert failed: ' + err.message);
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Missing GEMINI_API_KEY');
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL');
  }
  if (!process.env.DASHBOARD_BASE_URL) {
    throw new Error('Missing DASHBOARD_BASE_URL');
  }

  const startTime = Date.now();
  console.log('Starting sync...');

  const threads = await getGmailThreads();
  if (threads.length === 0) {
    console.log('No threads found');
    return;
  }

  const gmail = await getGmailClient();
  const todo = threads.slice(0, MAX_THREADS_PER_RUN);
  console.log('Processing ' + todo.length + ' threads this run\n');

  const apps = [];
  let quotaHit = false;

  for (let i = 0; i < todo.length; i++) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed > 300) {
      console.log('\nStopping early: approaching timeout (' + elapsed + 's)');
      break;
    }

    console.log((i + 1) + '/' + todo.length + ' ' + todo[i].id);
    const msg = await getMessageBody(gmail, todo[i].id);
    if (!msg) continue;

    const result = await extractWithGemini(msg);
    if (result === 'QUOTA') {
      quotaHit = true;
      break;
    }

    if (result) {
      result.emailSubject = msg.subject;
      result.emailDate = new Date(msg.date).toISOString().slice(0, 10);
      apps.push(result);
    }

    if (i < todo.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log('\nExtracted ' + apps.length + ' applications');
  if (quotaHit) console.log('(stopped early: quota hit)');

  await upsertApplications(apps);

  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log('\nSync completed in ' + totalTime + 's');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
