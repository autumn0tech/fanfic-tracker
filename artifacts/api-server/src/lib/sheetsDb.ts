/**
 * sheetsDb.ts — database layer backed by Google Sheets
 *
 * Google Sheets acts as the persistent store for all fic records.
 * Each row in the "fics" sheet corresponds to one FicRow object.
 * Columns (A–K):
 *   A  id          UUID, generated on insert
 *   B  url         canonical AO3 work URL (chapters path stripped)
 *   C  title
 *   D  author
 *   E  fandom      comma-separated for crossover works, e.g. "Fandom A, Fandom B"
 *   F  ship        comma-separated relationship tags, or empty
 *   G  wordCount   integer
 *   H  tags        JSON array of freeform AO3 tags
 *   I  dateAdded   ISO 8601 timestamp
 *   J  userRating  integer 1–5, or empty
 *   K  userNote    free text, or empty
 *
 * All reads go through getAllRows() which fetches A2:K (skipping the header).
 * Writes use append (create) or range update (update).
 * Deletes use batchUpdate deleteDimension to physically remove the row.
 */

import crypto from "crypto";
import {
  getUncachableGoogleSheetClient,
  getOrCreateSpreadsheet,
} from "./googleSheets";

// Name of the sheet tab inside the spreadsheet
const SHEET = "fics";

/** Typed representation of one fic record */
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

/**
 * Converts a raw Sheets row (string array) to a typed FicRow.
 * Handles missing cells gracefully with fallback values.
 * The tags column is stored as a JSON array string and parsed here.
 */
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

/**
 * Converts a typed FicRow back to a flat string array for writing to Sheets.
 * Null values become empty strings; tags are JSON-serialised.
 */
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

/**
 * Fetches all data rows from the sheet (row 2 onwards, skipping the header).
 * Returns the raw string arrays and the spreadsheet ID so callers don't have
 * to call getOrCreateSpreadsheet() separately.
 */
async function getAllRows(): Promise<{
  rows: string[][];
  spreadsheetId: string;
}> {
  const spreadsheetId = await getOrCreateSpreadsheet();
  const sheets = await getUncachableGoogleSheetClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET}!A2:K`, // A2:K = all data rows, skipping row 1 (header)
  });

  return {
    rows: (res.data.values as string[][] | null) ?? [],
    spreadsheetId,
  };
}

// ─── Public CRUD functions ───────────────────────────────────────────────────

/**
 * Returns all fics, sorted newest-first by dateAdded.
 * Empty rows (no ID) are filtered out as a safety measure.
 */
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

/** Returns a single fic by ID, or null if not found. */
export async function getFic(id: string): Promise<FicRow | null> {
  const { rows } = await getAllRows();
  const row = rows.find((r) => r[0] === id);
  return row ? rowToFic(row) : null;
}

/**
 * Appends a new fic row to the sheet.
 * Generates a UUID for the id and records the current timestamp as dateAdded.
 */
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

  // append adds a row after the last non-empty row in the range
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${SHEET}!A:K`,
    valueInputOption: "RAW",
    requestBody: { values: [ficToRow(fic)] },
  });

  return fic;
}

/**
 * Updates only the user-editable fields (rating and note) for an existing fic.
 * Reads all rows first to locate the correct row index, then overwrites just
 * that row using a targeted range update.
 *
 * Returns the updated FicRow, or null if the ID was not found.
 */
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
    // Only overwrite fields that were explicitly passed in the update payload
    userRating:
      data.userRating !== undefined ? data.userRating : existing.userRating,
    userNote:
      data.userNote !== undefined ? data.userNote : existing.userNote,
  };

  // rowIndex is 0-based within data rows; +1 for header row, +1 for 0→1-index = +2
  const sheetRow = rowIndex + 2;
  const sheets = await getUncachableGoogleSheetClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET}!A${sheetRow}:K${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [ficToRow(updated)] },
  });

  return updated;
}

/**
 * Permanently deletes a fic row from the sheet using batchUpdate deleteDimension.
 *
 * Why batchUpdate instead of clearing the row?
 *  Clearing would leave an empty row that getAllRows() would need to skip
 *  indefinitely.  deleteDimension physically removes the row so the sheet
 *  stays clean.
 *
 * Returns true if deleted, false if the ID was not found.
 */
export async function deleteFic(id: string): Promise<boolean> {
  const { rows, spreadsheetId } = await getAllRows();
  const rowIndex = rows.findIndex((r) => r[0] === id);
  if (rowIndex === -1) return false;

  const sheets = await getUncachableGoogleSheetClient();

  // Look up the internal numeric sheet ID (gid) — required by batchUpdate.
  // The title-based lookup handles cases where the sheet was manually renamed.
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets?.find(
    (s) => s.properties?.title === SHEET,
  );
  const sheetId = sheet?.properties?.sheetId ?? 0;

  // rowIndex is 0-based within data rows; +1 accounts for the header row
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
              startIndex: sheetRowIndex,     // inclusive
              endIndex: sheetRowIndex + 1,   // exclusive
            },
          },
        },
      ],
    },
  });

  return true;
}

/**
 * Returns reading statistics for the current calendar month.
 *
 * ficCount   — number of fics logged this month
 * fandomCount — number of unique fandoms read this month
 * month       — the month in "YYYY-MM" format
 *
 * Fandom deduplication:
 *  The fandom field can contain multiple fandoms separated by commas for
 *  crossover works (e.g. "Fandom A, Fandom B").  Each entry is split before
 *  being added to the Set so crossover fics don't double-count or inflate
 *  the unique fandom total.
 */
export async function getMonthlyStats(): Promise<{
  ficCount: number;
  fandomCount: number;
  month: string;
}> {
  const { rows } = await getAllRows();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Filter to rows logged this month (dateAdded is an ISO string; startsWith is sufficient)
  const monthRows = rows.filter(
    (row) => row[0] && row[8]?.startsWith(currentMonth),
  );

  // Split comma-separated fandom strings, trim whitespace, deduplicate
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
