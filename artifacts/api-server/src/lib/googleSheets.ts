import { google } from "googleapis";
import fs from "fs";
import path from "path";

// Google Sheets integration
// WARNING: Never cache this client — tokens expire

let connectionSettings: any;

async function getAccessToken() {
  if (
    connectionSettings &&
    connectionSettings.settings.expires_at &&
    new Date(connectionSettings.settings.expires_at).getTime() > Date.now()
  ) {
    return connectionSettings.settings.access_token;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error("X-Replit-Token not found for repl/depl");
  }

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

  const accessToken =
    connectionSettings?.settings?.access_token ||
    connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error("Google Sheet not connected");
  }
  return accessToken;
}

export async function getUncachableGoogleSheetClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

// Store spreadsheet ID in a file so we reuse the same sheet across restarts
const SHEET_ID_FILE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../data/sheet-id.txt",
);

let cachedSpreadsheetId: string | null = null;

export async function getOrCreateSpreadsheet(): Promise<string> {
  if (cachedSpreadsheetId) return cachedSpreadsheetId;

  // Try to read existing ID from file
  try {
    const saved = fs.readFileSync(SHEET_ID_FILE, "utf-8").trim();
    if (saved) {
      cachedSpreadsheetId = saved;
      return saved;
    }
  } catch {
    // File doesn't exist yet — will create the spreadsheet below
  }

  // Create a new spreadsheet with a header row
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
                  values: [
                    "id",
                    "url",
                    "title",
                    "author",
                    "fandom",
                    "ship",
                    "wordCount",
                    "tags",
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
  fs.mkdirSync(path.dirname(SHEET_ID_FILE), { recursive: true });
  fs.writeFileSync(SHEET_ID_FILE, spreadsheetId, "utf-8");
  cachedSpreadsheetId = spreadsheetId;
  return spreadsheetId;
}
