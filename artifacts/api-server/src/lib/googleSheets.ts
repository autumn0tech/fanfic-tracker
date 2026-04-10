/**
 * googleSheets.ts — low-level Google Sheets authentication and spreadsheet bootstrap
 *
 * Authentication flow:
 *  1. Call the Replit Connectors API to retrieve a fresh Google OAuth access token
 *     for the connected google-sheet integration.
 *  2. Create a googleapis OAuth2 client and attach the token.
 *  3. Return a fully-authenticated Sheets v4 client.
 *
 * Why not cache the client?
 *  Google OAuth tokens expire after ~1 hour.  Rather than managing token refresh
 *  ourselves we fetch a fresh token from the Connectors API on every request —
 *  the API handles refreshing internally.  The function name
 *  getUncachableGoogleSheetClient makes this constraint explicit to callers.
 *
 * Spreadsheet bootstrap:
 *  The first time the app runs there is no spreadsheet yet.  getOrCreateSpreadsheet()
 *  checks for a saved ID in data/sheet-id.txt (gitignored), creates the sheet with
 *  the correct header row if not found, and persists the new ID to disk so it
 *  survives server restarts.
 */

import { google } from "googleapis";
import fs from "fs";
import path from "path";

// In-memory cache of the last connector response — avoids hammering the API
// when multiple requests arrive in quick succession within the same token lifetime.
let connectionSettings: any;

/**
 * Fetches (or returns a cached) Google OAuth access token via the Replit
 * Connectors API.  The cache is invalidated when expires_at is in the past.
 */
async function getAccessToken() {
  // Return cached token if it hasn't expired yet
  if (
    connectionSettings &&
    connectionSettings.settings.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
  ) {
    return connectionSettings.settings.access_token;
  }

  // Build the Replit identity token header.
  // In development the REPL_IDENTITY env var is set; in production WEB_REPL_RENEWAL is used.
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error("X-Replit-Token not found for repl/depl");
  }

  // Fetch the connection settings including the OAuth credentials
  connectionSettings = await fetch(
    "https://" +
      hostname +
      "/api/v2/connection?include_secrets=true&connector_names=google-sheet",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    },
  )
    .then((res) => res.json())
    .then((data) => data.items?.[0]);

  // The token can be in different locations depending on the connector version
  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error("Google Sheet not connected");
  }
  return accessToken;
}

/**
 * Returns a googleapis Sheets v4 client authenticated with a fresh OAuth token.
 * Always call this immediately before making a Sheets API request — do not store
 * the returned client between requests.
 */
export async function getUncachableGoogleSheetClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

// Path where the spreadsheet ID is persisted on disk.
// This file is listed in .gitignore so it is never committed to version control.
const SHEET_ID_FILE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../data/sheet-id.txt",
);

// Module-level cache so multiple calls in one process lifetime skip the file read
let cachedSpreadsheetId: string | null = null;

/**
 * Returns the Google Sheets spreadsheet ID that stores all fic data.
 *
 * On the very first run (no sheet-id.txt file):
 *  - Creates a new Google Spreadsheet titled "Fanfic Tracker"
 *  - Adds a "fics" sheet with the correct 11-column header row
 *  - Persists the new spreadsheet ID to sheet-id.txt for future restarts
 *
 * On subsequent runs:
 *  - Reads the ID from the in-memory cache or sheet-id.txt
 */
export async function getOrCreateSpreadsheet(): Promise<string> {
  // Fast path: already loaded this session
  if (cachedSpreadsheetId) return cachedSpreadsheetId;

  // Try to read a previously saved spreadsheet ID from disk
  try {
    const saved = fs.readFileSync(SHEET_ID_FILE, "utf-8").trim();
    if (saved) {
      cachedSpreadsheetId = saved;
      return saved;
    }
  } catch {
    // File doesn't exist yet — fall through to create a new spreadsheet
  }

  // Create the spreadsheet with the header row already populated
  const sheets = await getUncachableGoogleSheetClient();
  const res = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: "Fanfic Tracker" },
      sheets: [
        {
          properties: { title: "fics" },
          data: [
            {
              rowData: [
                {
                  // Columns A–K (11 columns matching the FicRow interface)
                  values: [
                    "id",
                    "url",
                    "title",
                    "author",
                    "fandom",
                    "ship",
                    "wordCount",
                    "tags",       // stored as JSON array string
                    "dateAdded",
                    "userRating",
                    "userNote",
                  ].map((h) => ({ userEnteredValue: { stringValue: h } })),
                },
              ],
            },
          ],
        },
      ],
    },
  });

  const spreadsheetId = res.data.spreadsheetId!;

  // Persist so the same sheet is reused after a server restart
  fs.mkdirSync(path.dirname(SHEET_ID_FILE), { recursive: true });
  fs.writeFileSync(SHEET_ID_FILE, spreadsheetId, "utf-8");
  cachedSpreadsheetId = spreadsheetId;
  return spreadsheetId;
}
