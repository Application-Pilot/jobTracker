/**
 * Job Application Tracker — Gmail sync via Apps Script.
 *
 * Reads recent inbox threads matching job-related keywords, sends each
 * candidate email to Gemini for structured extraction, then POSTs the
 * resulting applications to your deployed dashboard's /api/applications/upsert.
 *
 * Setup (one-time):
 *  1. In your Google Sheet (the same one shared with the service account),
 *     Extensions → Apps Script. Paste this file in.
 *  2. Project Settings → Script properties, set:
 *       GEMINI_API_KEY      — your Gemini key (rotate the one shared in chat)
 *       DASHBOARD_BASE_URL  — e.g. https://your-app.vercel.app
 *       SYNC_SHARED_SECRET  — same value as your dashboard's env var (optional)
 *       LOOKBACK_DAYS       — how far back to scan (default 14)
 *  3. Run `installDailyTrigger` once (authorize Gmail + UrlFetch when asked).
 *  4. Run `syncNow` manually to test.
 */

const KEYWORD_QUERY =
  'newer_than:{LOOKBACK}d (' +
  'subject:(application OR applied OR offer OR interview OR rejection OR' +
  ' "thank you for applying" OR "next steps" OR "we regret" OR "unfortunately"' +
  ' OR "moving forward") OR' +
  ' "job application" OR "we received your application" OR' +
  ' "interview" OR "we are excited" OR "your application")';

const GEMINI_MODEL = 'gemini-flash-latest';
const MAX_THREADS_PER_RUN = 25;
const REQUEST_DELAY_MS = 12000;

const EXTRACTION_PROMPT = [
  'You analyze a single email message and extract structured info about a job application.',
  'If the email is NOT about a job application, offer, interview, or rejection, respond with',
  'exactly the literal string SKIP and nothing else.',
  '',
  'Otherwise return a JSON object with these fields (strings, empty string when unknown):',
  '  jobTitle         — role title, e.g. "Senior Backend Engineer"',
  '  company          — hiring company name',
  '  appliedDate      — YYYY-MM-DD if explicitly stated, else empty',
  '  status           — one of: pending | interview | accepted | rejected',
  '  interviewDate    — YYYY-MM-DD if scheduled, else empty',
  '  rejectionReason  — short reason if rejection, else empty',
  '  jobLink          — a job posting URL found in the email, else empty',
  '  salaryRange      — exact salary text if present, else empty',
  '  location         — city/remote/hybrid info if present, else empty',
  '',
  'Return ONLY the JSON object — no markdown fences, no commentary.',
].join('\n');

function prop(name, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  return v == null || v === '' ? fallback : v;
}

function syncNow() {
  const lookback = parseInt(prop('LOOKBACK_DAYS', '14'), 10);
  const baseUrl = prop('DASHBOARD_BASE_URL', '');
  if (!baseUrl) throw new Error('Set DASHBOARD_BASE_URL in script properties');
  const secret = prop('SYNC_SHARED_SECRET', '');
  const geminiKey = prop('GEMINI_API_KEY', '');
  if (!geminiKey) throw new Error('Set GEMINI_API_KEY in script properties');

  const query = KEYWORD_QUERY.replace('{LOOKBACK}', String(lookback));
  const allThreads = GmailApp.search(query, 0, 50);
  const threads = allThreads.slice(0, MAX_THREADS_PER_RUN);
  Logger.log(
    'Threads matched: ' + allThreads.length +
    ' (processing ' + threads.length + ')',
  );

  const apps = [];
  let quotaHit = false;
  for (let i = 0; i < threads.length; i++) {
    if (quotaHit) break;
    const msgs = threads[i].getMessages();
    const msg = msgs[msgs.length - 1];
    const result = extractWithGemini(geminiKey, msg);
    if (result === 'QUOTA') { quotaHit = true; break; }
    if (result) {
      result.emailSubject = msg.getSubject() || '';
      result.emailDate = msg.getDate().toISOString().slice(0, 10);
      apps.push(result);
    }
    if (i < threads.length - 1) Utilities.sleep(REQUEST_DELAY_MS);
  }
  if (quotaHit) Logger.log('Stopped early: Gemini quota exhausted.');

  if (apps.length === 0) {
    Logger.log('Nothing to upsert.');
    return;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (secret) headers['Authorization'] = 'Bearer ' + secret;
  const res = UrlFetchApp.fetch(baseUrl + '/api/applications/upsert', {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify({ applications: apps }),
    muteHttpExceptions: true,
  });
  Logger.log('Upsert response: ' + res.getResponseCode() + ' ' + res.getContentText());
}

function extractWithGemini(apiKey, msg) {
  const body = msg.getPlainBody() || msg.getBody() || '';
  const truncated = body.slice(0, 8000);
  const userPart =
    'Subject: ' + (msg.getSubject() || '') + '\n' +
    'From: ' + (msg.getFrom() || '') + '\n' +
    'Date: ' + msg.getDate().toISOString() + '\n\n' +
    truncated;

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    GEMINI_MODEL +
    ':generateContent?key=' +
    encodeURIComponent(apiKey);

  const payload = {
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
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() === 429) {
    Logger.log('Gemini quota hit (429) — stopping run.');
    return 'QUOTA';
  }
  if (res.getResponseCode() >= 300) {
    Logger.log('Gemini error ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    return null;
  }
  const json = JSON.parse(res.getContentText());
  const text =
    (json.candidates &&
      json.candidates[0] &&
      json.candidates[0].content &&
      json.candidates[0].content.parts &&
      json.candidates[0].content.parts[0] &&
      json.candidates[0].content.parts[0].text) ||
    '';
  const trimmed = text.trim();
  if (!trimmed || trimmed === 'SKIP') return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed.jobTitle || !parsed.company) return null;
    return parsed;
  } catch (e) {
    Logger.log('JSON parse failed for: ' + trimmed.slice(0, 200));
    return null;
  }
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncNow').timeBased().everyDays(1).atHour(9).create();
  Logger.log('Daily 9am trigger installed.');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(t);
  });
}
