import { google, sheets_v4 } from "googleapis";
import {
  Application,
  SHEET_HEADERS,
  SHEET_NAME,
  SHEET_RANGE,
  applicationToRow,
  rowToApplication,
} from "./types";

let cachedClient: sheets_v4.Sheets | null = null;

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !rawKey) {
    throw new Error(
      "Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY env vars",
    );
  }
  const privateKey = rawKey.replace(/\\n/g, "\n");
  return new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetId() {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error("Missing GOOGLE_SHEETS_ID env var");
  return id;
}

function client() {
  if (!cachedClient) {
    cachedClient = google.sheets({ version: "v4", auth: getAuth() });
  }
  return cachedClient;
}

export async function ensureHeaderRow() {
  const sheets = client();
  const spreadsheetId = getSheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:M1`,
  });
  const existing = res.data.values?.[0] ?? [];
  if (existing.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:M1`,
      valueInputOption: "RAW",
      requestBody: { values: [SHEET_HEADERS as string[]] },
    });
  }
}

export async function listApplications(): Promise<Application[]> {
  const sheets = client();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: SHEET_RANGE,
  });
  const rows = res.data.values ?? [];
  if (rows.length <= 1) return [];
  return rows.slice(1).map(rowToApplication).filter((a) => a.id);
}

export async function appendApplication(app: Application): Promise<void> {
  const sheets = client();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSheetId(),
    range: SHEET_RANGE,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [applicationToRow(app)] },
  });
}

export async function updateApplication(app: Application): Promise<void> {
  const sheets = client();
  const spreadsheetId = getSheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:A`,
  });
  const ids = res.data.values ?? [];
  const rowIndex = ids.findIndex((r) => r[0] === app.id);
  if (rowIndex < 1) throw new Error(`Application ${app.id} not found`);
  const sheetRow = rowIndex + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A${sheetRow}:M${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [applicationToRow(app)] },
  });
}

export async function deleteApplication(id: string): Promise<void> {
  const sheets = client();
  const spreadsheetId = getSheetId();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:A`,
  });
  const ids = res.data.values ?? [];
  const rowIndex = ids.findIndex((r) => r[0] === id);
  if (rowIndex < 1) throw new Error(`Application ${id} not found`);

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(
    (s) => s.properties?.title === SHEET_NAME,
  );
  const sheetIdNum = sheet?.properties?.sheetId;
  if (sheetIdNum == null) throw new Error("Sheet tab not found");

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetIdNum,
              dimension: "ROWS",
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        },
      ],
    },
  });
}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
