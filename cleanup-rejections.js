// One-shot cleanup: collapse standalone "rejected" rows into their original applications.
//
// For each row currently status=rejected:
//   1. Try to find a matching non-rejected application (fuzzy company match,
//      then jobTitle disambiguation, else most recent).
//   2. If a target is found: update that row to rejected (carrying over
//      rejectionReason / notes / location / salaryRange / jobLink from the
//      orphan, only when the target's field is empty), then delete the orphan.
//   3. If no target: safedelete the orphan row.
//
// Usage:  node cleanup-rejections.js          # dry run (default, no writes)
//         node cleanup-rejections.js --apply  # actually mutate the sheet
//
// Reads env vars: GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL,
// GOOGLE_SERVICE_ACCOUNT_KEY (same as the app).

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const file = path.join(__dirname, '.env.local');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvLocal();

const APPLY = process.argv.includes('--apply');
const SHEET_NAME = 'Applications';
const RANGE = `${SHEET_NAME}!A:O`;
const HEADERS = [
  'id', 'jobTitle', 'company', 'appliedDate', 'status', 'interviewDate',
  'rejectionReason', 'jobLink', 'emailSubject', 'emailDate', 'salaryRange',
  'location', 'notes', 'easyApply', 'gmailThreadId',
];

function normalizeCompany(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function companiesMatch(a, b) {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

function tokens(s) {
  return new Set(
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function pickRejectionTarget(incoming, candidates) {
  const matches = candidates.filter((a) => companiesMatch(a.company, incoming.company));
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const titleA = tokens(incoming.jobTitle);
  if (titleA.size > 0) {
    const scored = matches
      .map((a) => ({ a, s: jaccard(titleA, tokens(a.jobTitle)) }))
      .sort((x, y) => y.s - x.s);
    if (scored[0].s >= 0.4 && (scored.length === 1 || scored[0].s > scored[1].s)) {
      return scored[0].a;
    }
  }

  return [...matches].sort((a, b) => {
    const da = a.appliedDate || a.emailDate || '';
    const db = b.appliedDate || b.emailDate || '';
    if (da !== db) return db.localeCompare(da);
    return (b.id || '').localeCompare(a.id || '');
  })[0];
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !rawKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY');
  }
  return new google.auth.JWT({
    email,
    key: rawKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function rowToApp(row) {
  const app = {};
  HEADERS.forEach((h, i) => { app[h] = row[i] || ''; });
  return app;
}

function appToRow(app) {
  return HEADERS.map((h) => app[h] || '');
}

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
  if (!spreadsheetId) throw new Error('Missing GOOGLE_SHEETS_ID');
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetTab = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME);
  if (!sheetTab) throw new Error(`Sheet tab "${SHEET_NAME}" not found`);
  const sheetIdNum = sheetTab.properties.sheetId;

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
  const rows = res.data.values || [];
  if (rows.length <= 1) {
    console.log('No data rows.');
    return;
  }

  // Index rows with their 1-based sheet row number (header is row 1).
  const apps = rows.slice(1).map((r, i) => ({ ...rowToApp(r), _sheetRow: i + 2 }));
  const rejected = apps.filter((a) => a.status === 'rejected');
  const candidates = apps.filter((a) => a.status !== 'rejected');

  console.log(`${apps.length} total rows | ${rejected.length} rejected | ${candidates.length} candidates`);
  console.log(APPLY ? 'MODE: APPLY (writing)' : 'MODE: DRY RUN (use --apply to write)');
  console.log('');

  const updates = []; // { sheetRow, app } — full row writes for matched targets
  const deletes = []; // sheetRow numbers to delete (orphan rejection rows)
  let merged = 0;
  let safeDeleted = 0;

  for (const orphan of rejected) {
    const target = pickRejectionTarget(orphan, candidates);
    if (!target) {
      console.log(`  SAFE-DELETE  row ${orphan._sheetRow}  "${orphan.company}" / "${orphan.jobTitle}"  (no match)`);
      deletes.push(orphan._sheetRow);
      safeDeleted++;
      continue;
    }
    console.log(
      `  MERGE        orphan row ${orphan._sheetRow} ("${orphan.company}" / "${orphan.jobTitle}") ` +
      `→ target row ${target._sheetRow} ("${target.company}" / "${target.jobTitle}")`,
    );
    const mergedApp = {
      ...target,
      status: 'rejected',
      rejectionReason: target.rejectionReason || orphan.rejectionReason || '',
      jobLink: target.jobLink || orphan.jobLink || '',
      salaryRange: target.salaryRange || orphan.salaryRange || '',
      location: target.location || orphan.location || '',
      notes: target.notes || orphan.notes || '',
    };
    updates.push({ sheetRow: target._sheetRow, app: mergedApp });
    deletes.push(orphan._sheetRow);
    merged++;
    // Remove target from candidate pool so it can't absorb a second orphan.
    const idx = candidates.indexOf(target);
    if (idx >= 0) candidates.splice(idx, 1);
  }

  console.log('');
  console.log(`Plan: ${merged} merge(s), ${safeDeleted} safe-delete(s), ${deletes.length} row(s) to remove total.`);

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to mutate the sheet.');
    return;
  }
  if (deletes.length === 0 && updates.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  // 1. Apply target updates first (while rows still exist at their original positions).
  for (const u of updates) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A${u.sheetRow}:O${u.sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [appToRow(u.app)] },
    });
  }
  console.log(`Updated ${updates.length} target row(s).`);

  // 2. Delete orphans bottom-up so earlier indices stay valid.
  const sortedDeletes = [...new Set(deletes)].sort((a, b) => b - a);
  const requests = sortedDeletes.map((sheetRow) => ({
    deleteDimension: {
      range: {
        sheetId: sheetIdNum,
        dimension: 'ROWS',
        startIndex: sheetRow - 1, // 0-based, inclusive
        endIndex: sheetRow,        // exclusive
      },
    },
  }));
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  console.log(`Deleted ${sortedDeletes.length} orphan rejection row(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
