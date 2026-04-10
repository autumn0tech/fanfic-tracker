import crypto from "crypto";
import {
  getUncachableGoogleSheetClient,
  getOrCreateSpreadsheet,
} from "./googleSheets";

const SHEET = "fics";

export interface FicRow {
  id: string;
  url: string;
  title: string;
  author: string;
  fandom: string;
  ship: string | null;
  wordCount: number;
  tags: string[];
  dateAdded: string;
  userRating: number | null;
  userNote: string | null;
}

function rowToFic(row: string[]): FicRow {
  return {
    id: row[0] ?? "",
    url: row[1] ?? "",
    title: row[2] ?? "",
    author: row[3] ?? "",
    fandom: row[4] ?? "",
    ship: row[5] || null,
    wordCount: parseInt(row[6] ?? "0", 10) || 0,
    tags: row[7] ? (JSON.parse(row[7]) as string[]) : [],
    dateAdded: row[8] ?? "",
    userRating: row[9] ? parseInt(row[9], 10) : null,
    userNote: row[10] || null,
  };
}

function ficToRow(fic: FicRow): string[] {
  return [
    fic.id,
    fic.url,
    fic.title,
    fic.author,
    fic.fandom,
    fic.ship ?? "",
    String(fic.wordCount),
    JSON.stringify(fic.tags),
    fic.dateAdded,
    fic.userRating != null ? String(fic.userRating) : "",
    fic.userNote ?? "",
  ];
}

async function getAllRows(): Promise<{
  rows: string[][];
  spreadsheetId: string;
}> {
  const spreadsheetId = await getOrCreateSpreadsheet();
  const sheets = await getUncachableGoogleSheetClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET}!A2:K`, // Skip header row
  });

  return {
    rows: (res.data.values as string[][] | null) ?? [],
    spreadsheetId,
  };
}

export async function listFics(): Promise<FicRow[]> {
  const { rows } = await getAllRows();
  return rows
    .filter((row) => row[0])
    .map(rowToFic)
    .sort(
      (a, b) =>
        new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime(),
    );
}

export async function getFic(id: string): Promise<FicRow | null> {
  const { rows } = await getAllRows();
  const row = rows.find((r) => r[0] === id);
  return row ? rowToFic(row) : null;
}

export async function createFic(
  data: Omit<FicRow, "id" | "dateAdded">,
): Promise<FicRow> {
  const spreadsheetId = await getOrCreateSpreadsheet();
  const sheets = await getUncachableGoogleSheetClient();

  const fic: FicRow = {
    ...data,
    id: crypto.randomUUID(),
    dateAdded: new Date().toISOString(),
  };

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET}!A:K`,
    valueInputOption: "RAW",
    requestBody: { values: [ficToRow(fic)] },
  });

  return fic;
}

export async function updateFic(
  id: string,
  data: { userRating?: number | null; userNote?: string | null },
): Promise<FicRow | null> {
  const { rows, spreadsheetId } = await getAllRows();
  const rowIndex = rows.findIndex((r) => r[0] === id);
  if (rowIndex === -1) return null;

  const existing = rowToFic(rows[rowIndex]);
  const updated: FicRow = {
    ...existing,
    userRating:
      data.userRating !== undefined ? data.userRating : existing.userRating,
    userNote:
      data.userNote !== undefined ? data.userNote : existing.userNote,
  };

  const sheetRow = rowIndex + 2; // +1 for 0-index, +1 for header row
  const sheets = await getUncachableGoogleSheetClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET}!A${sheetRow}:K${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [ficToRow(updated)] },
  });

  return updated;
}

export async function deleteFic(id: string): Promise<boolean> {
  const { rows, spreadsheetId } = await getAllRows();
  const rowIndex = rows.findIndex((r) => r[0] === id);
  if (rowIndex === -1) return false;

  const sheets = await getUncachableGoogleSheetClient();

  // Look up the internal sheet ID (gid) for batchUpdate
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets?.find(
    (s) => s.properties?.title === SHEET,
  );
  const sheetId = sheet?.properties?.sheetId ?? 0;

  // rowIndex is 0-based within data rows; add 1 to account for header
  const sheetRowIndex = rowIndex + 1;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: sheetRowIndex,
              endIndex: sheetRowIndex + 1,
            },
          },
        },
      ],
    },
  });

  return true;
}

export async function getMonthlyStats(): Promise<{
  ficCount: number;
  fandomCount: number;
  month: string;
}> {
  const { rows } = await getAllRows();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const monthRows = rows.filter(
    (row) => row[0] && row[8]?.startsWith(currentMonth),
  );
  // Split compound fandom strings (e.g. "Fandom A, Fandom B") into individual
  // fandoms before deduplicating, so crossover fics don't inflate the count.
  const fandoms = new Set(
    monthRows.flatMap((r) =>
      r[4]
        ? r[4]
            .split(",")
            .map((f: string) => f.trim())
            .filter(Boolean)
        : [],
    ),
  );

  return {
    ficCount: monthRows.length,
    fandomCount: fandoms.size,
    month: currentMonth,
  };
}
