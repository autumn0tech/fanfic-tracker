import * as cheerio from "cheerio";

const AO3_HOSTNAME = "archiveofourown.org";

// When running on a cloud server (like Replit), Cloudflare may block the direct
// connection at the TLS level (HTTP 525). We fall back to a CORS proxy that can
// reach AO3 from a non-blocked IP range.
const CORS_PROXY = "https://api.allorigins.win/raw?url=";

// Enforce a minimum gap between AO3 requests to avoid triggering rate limits
const MIN_REQUEST_GAP_MS = 3000;
let lastRequestAt = 0;

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_GAP_MS - elapsed),
    );
  }
  lastRequestAt = Date.now();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// These status codes indicate Cloudflare/CDN interference — worth retrying via proxy
const CLOUDFLARE_STATUSES = new Set([502, 503, 504, 520, 521, 522, 524, 525, 526]);

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

// Attempt a direct fetch. Returns null if Cloudflare blocks us (so we can try proxy).
async function tryDirect(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(8000),
    });
    if (CLOUDFLARE_STATUSES.has(res.status)) return null;
    return res;
  } catch {
    // SSL handshake errors and network errors both land here
    return null;
  }
}

// Fetch via the allorigins.win proxy (bypasses Cloudflare IP blocks)
async function tryProxy(url: string): Promise<Response> {
  const proxyUrl = CORS_PROXY + encodeURIComponent(url);
  return fetch(proxyUrl, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(20000),
  });
}

export interface ScrapedData {
  url: string;
  title: string;
  author: string;
  fandom: string;
  ship: string | null;
  wordCount: number;
  tags: string[];
}

export function validateAO3Url(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === AO3_HOSTNAME &&
      parsed.pathname.startsWith("/works/")
    );
  } catch {
    return false;
  }
}

function parseHtml(html: string, originalUrl: string): ScrapedData {
  const $ = cheerio.load(html);

  const title = $("h2.title.heading").text().trim();
  const author =
    $('a[rel="author"]').first().text().trim() ||
    $("h3.byline.heading").text().trim();

  const fandoms = $("dd.fandom.tags a.tag")
    .map((_, el) => $(el).text().trim())
    .get();
  const fandom = fandoms.join(", ") || "Unknown";

  const ships = $("dd.relationship.tags a.tag")
    .map((_, el) => $(el).text().trim())
    .get();
  const ship = ships.length > 0 ? ships.join(", ") : null;

  const wordCountRaw = $("dd.words").text().trim().replace(/,/g, "");
  const wordCount = parseInt(wordCountRaw, 10) || 0;

  const tags = $("dd.freeform.tags a.tag")
    .map((_, el) => $(el).text().trim())
    .get();

  if (!title) {
    throw new Error(
      "Could not read the fic — the page returned by AO3 didn't contain expected metadata. The work may be locked, deleted, or AO3 may be blocking this request.",
    );
  }

  return { url: originalUrl, title, author, fandom, ship, wordCount, tags };
}

const MAX_RETRIES = 2;

export async function scrapeFic(url: string): Promise<ScrapedData> {
  if (!validateAO3Url(url)) {
    throw new Error("Only archiveofourown.org work URLs are supported");
  }

  // Always force view_adult=true so mature/explicit fics aren't hidden behind a login wall
  const fetchUrl = new URL(url);
  fetchUrl.searchParams.set("view_adult", "true");
  const finalUrl = fetchUrl.toString();

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await waitForRateLimit();

    // 1. Try direct connection first (fast — works when not on a blocked IP)
    let response = await tryDirect(finalUrl);

    // 2. If Cloudflare blocked us, immediately fall back to the proxy
    if (response === null) {
      try {
        response = await tryProxy(finalUrl);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          await delay(3000 * attempt);
          continue;
        }
        throw new Error(
          `Could not reach AO3 directly or via proxy after ${MAX_RETRIES} attempts. AO3 may be temporarily down.`,
        );
      }
    }

    // Handle non-retryable HTTP errors
    if (response.status === 429) {
      throw new Error(
        "AO3 is rate-limiting requests — please wait a minute and try again.",
      );
    }
    if (response.status === 403) {
      throw new Error("AO3 refused this request. Please try again shortly.");
    }
    if (response.status === 404) {
      throw new Error(
        "That AO3 work doesn't exist, has been deleted, or is locked.",
      );
    }
    if (!response.ok) {
      lastError = new Error(`AO3 returned HTTP ${response.status}`);
      if (attempt < MAX_RETRIES) {
        await delay(3000 * attempt);
        continue;
      }
      throw lastError;
    }

    // Parse and return
    try {
      const html = await response.text();
      return parseHtml(html, url);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await delay(3000 * attempt);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("Scrape failed");
}
