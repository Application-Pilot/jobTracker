// One-shot: subtract 1 day from any appliedDate that's >= today (local PDT).
// Reason: UTC date-defaulting in upsert/route.ts stamped evening syncs with
// tomorrow's date. This walks the sheet and rolls those rows back by one day.
//
// Usage:  node fix-dates.js [--dry-run]
//   --dry-run prints what would change without writing.
// Reads the same env vars the app uses (GOOGLE_SHEETS_ID, etc).

const { google } = require('googleapis');

const DRY_RUN = process.argv.includes('--dry-run');
const SHEET_NAME = 'Applications';
const APPLIED_DATE_COL_INDEX = 3; // column D, 0-indexed

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rollBackOneDay(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !rawKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY');
  }
  const privateKey = rawKey.replace(/\\n/g, '\n');
  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function main() {
  const sheetId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetId) throw new Error('Missing GOOGLE_SHEETS_ID');

  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const today = todayLocal();
  const cutoff = today; // anything >= today gets rolled back by 1

  console.log(`Today (local): ${today}`);
  console.log(`Will roll back any appliedDate >= ${cutoff} by 1 day`);
  if (DRY_RUN) console.log('(dry-run mode — no writes)');
  console.log('');

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:O`,
  });
  const rows = res.data.values || [];
  if (rows.length <= 1) {
    console.log('No data rows found.');
    return;
  }

  const updates = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const id = row[0];
    const oldDate = (row[APPLIED_DATE_COL_INDEX] || '').slice(0, 10);
    if (!oldDate) continue;
    if (oldDate >= cutoff) {
      const newDate = rollBackOneDay(oldDate);
      const sheetRow = i + 1;
      updates.push({
        sheetRow,
        id,
        oldDate,
        newDate,
        range: `${SHEET_NAME}!D${sheetRow}`,
      });
    }
  }

  console.log(`Rows to update: ${updates.length}`);
  for (const u of updates) {
    console.log(`  row ${u.sheetRow} (${u.id}): ${u.oldDate} → ${u.newDate}`);
  }

  if (updates.length === 0 || DRY_RUN) return;

  console.log('\nApplying updates via batchUpdate...');
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates.map((u) => ({
        range: u.range,
        values: [[u.newDate]],
      })),
    },
  });
  console.log(`✓ Updated ${updates.length} rows.`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
