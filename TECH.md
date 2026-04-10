# Fanfic Tracker — Technical Documentation

A personal reading log for Archive of Our Own (AO3) fanfiction. Users save fics
via a browser bookmarklet, rate them 1–5 stars, write personal notes, and view
monthly reading statistics. All data is stored in Google Sheets — no dedicated
database required.

---

## Architecture Overview

```
Browser (React + Vite)
    │
    │  HTTP (JSON REST)
    ▼
Express API Server (Node.js + TypeScript)
    │
    │  Google Sheets API v4 (OAuth via Replit connector)
    ▼
Google Spreadsheet ("Fanfic Tracker")
    └── sheet tab: "fics"  (one row per fic, 11 columns)
```

The project lives in a **pnpm monorepo** with three main packages:

| Package | Path | Purpose |
|---|---|---|
| `@workspace/fanfic-tracker` | `artifacts/fanfic-tracker/` | React + Vite frontend |
| `@workspace/api-server` | `artifacts/api-server/` | Express REST API |
| `@workspace/api-client-react` | `lib/api-client-react/` | Auto-generated TanStack Query hooks |
| `@workspace/api-zod` | `lib/api-zod/` | Shared Zod validation schemas |

---

## How the Bookmarklet Works

AO3 uses Cloudflare protection, which blocks server-side HTTP scraping.  The
bookmarklet is a client-side workaround:

1. The user drags the **"Save to Reading Log"** button to their browser bookmarks bar.
2. On any AO3 work page they click the bookmark.
3. The bookmarklet code (a `javascript:` URL) runs in the AO3 page context and:
   - Validates the page is an AO3 work URL.
   - Reads metadata directly from the DOM: title (`h2.title.heading`), author
     (`[rel=author]`), fandoms (`dd.fandom.tags a.tag`), ships
     (`dd.relationship.tags a.tag`), word count (`dd.words`), and freeform tags
     (`dd.freeform.tags a.tag`).
   - Strips `/chapters/...` from the URL so multi-chapter works always store the
     canonical work URL.
   - JSON-encodes all metadata and redirects the browser to:
     `<app-url>?import=<url-encoded-json>`
4. The app detects the `?import=` query parameter on load, decodes it, POSTs to
   `/fics`, then uses `history.replaceState` to remove the parameter from the URL.

**Why `javascript:` hrefs need special handling in React:**
React sanitises `javascript:` href values set via JSX props (treats them as
unsafe). The bookmarklet anchor uses a `useCallback` ref to call
`node.setAttribute("href", bookmarkletHref)` directly on the DOM node, bypassing
React's sanitisation.

---

## Data Model

Each fic is stored as a row in the Google Sheet with 11 columns:

| Column | Field | Type | Notes |
|---|---|---|---|
| A | `id` | UUID string | Generated on insert |
| B | `url` | string | Canonical AO3 work URL |
| C | `title` | string | |
| D | `author` | string | "Anonymous" if AO3 author is hidden |
| E | `fandom` | string | Comma-separated for crossover works |
| F | `ship` | string \| "" | Comma-separated relationship tags |
| G | `wordCount` | integer string | |
| H | `tags` | JSON string | Array of freeform AO3 tags |
| I | `dateAdded` | ISO 8601 string | Set at insert time |
| J | `userRating` | "1"–"5" \| "" | User's star rating |
| K | `userNote` | string \| "" | User's personal journal note |

---

## API Endpoints

All endpoints are prefixed under the API server's base path.

| Method | Path | Description |
|---|---|---|
| `GET` | `/fics` | List all fics, sorted newest-first |
| `POST` | `/fics` | Create a new fic (called by bookmarklet redirect) |
| `GET` | `/fics/:id` | Get a single fic by UUID |
| `PATCH` | `/fics/:id` | Update `userRating` and/or `userNote` |
| `DELETE` | `/fics/:id` | Permanently delete a fic row from the sheet |
| `GET` | `/stats/monthly` | Fic count + unique fandom count for current month |
| `POST` | `/fics/scrape` | (Legacy) Server-side AO3 scrape — often blocked by Cloudflare |

Request bodies and response shapes are validated with **Zod** schemas defined in
`@workspace/api-zod`.  The Express router imports those schemas and parses every
request through them before touching the database layer, so type errors are caught
at the boundary.

---

## Google Sheets Integration

Authentication uses Replit's **Google Sheets connector** (OAuth 2.0).  The
connector stores and refreshes the OAuth token transparently; the API server
retrieves it at request time by calling the Replit Connectors API with a
`REPL_IDENTITY` token.

**Why not cache the Google Sheets client?**
Google OAuth access tokens expire after ~1 hour.  Rather than managing refresh
logic in application code, `getUncachableGoogleSheetClient()` fetches a fresh
token on every request.  The function name makes this intent explicit.

**Spreadsheet bootstrap:**
On first run there is no spreadsheet.  `getOrCreateSpreadsheet()` creates one
titled "Fanfic Tracker" with the correct header row and saves the spreadsheet ID
to `artifacts/api-server/data/sheet-id.txt`.  This file is listed in `.gitignore`
so it is never committed to version control.  On subsequent runs the ID is read
from that file (and cached in memory for the process lifetime).

**Deletes use `deleteDimension`:**
Clearing a row would leave an empty slot that the read logic would need to skip
forever.  Using `batchUpdate` with a `deleteDimension` request physically removes
the row, keeping the sheet clean.

**Fandom deduplication:**
The `fandom` column stores multiple fandoms as a comma-separated string for
crossover works (e.g. `"Fandom A, Fandom B"`).  `getMonthlyStats` splits on `,`
before adding to a `Set`, so crossover fics count each constituent fandom once
rather than inflating the unique fandom total.

---

## Frontend Features

### Home Page (`Home.tsx`)

**Stats card** (header):
- Monthly fic count and unique fandom count from the `/stats/monthly` endpoint.
- **Reading streak** — counts consecutive calendar days (all-time) with at least
  one fic logged.  The streak remains alive if today **or** yesterday has an
  entry, so logging before midnight doesn't break the streak.  Displayed as an
  orange flame badge.
- **Tag word cloud** — aggregates all freeform tags from this month's fics,
  filters to tags appearing more than once, takes the top 10 by frequency, and
  renders each as a pill whose font size (0.78–1.45 rem) and opacity (0.55–1.0)
  scale with frequency.
- **Favourite authors** — authors with 5 or more fics logged are shown as
  toggleable heart-chip buttons.  Clicking toggles their favourite status.
  Favourited authors are sorted first within the list.

**Fic list** — sorted newest-first, each entry rendered as a `FicCard`.

### FicCard (`FicCard.tsx`)

Each card is a link to the detail page.  A small heart icon next to the author
name toggles that author as a favourite without navigating — handled by
`e.preventDefault()` + `e.stopPropagation()` on the button's click handler.

### FicDetail (`FicDetail.tsx`)

Read/edit toggle for personal rating and notes.  Saves via `PATCH /fics/:id`.
After a successful save the TanStack Query cache is updated directly so the UI
reflects changes without waiting for a refetch.

Delete triggers a confirmation `AlertDialog` before calling `DELETE /fics/:id`
and navigating back home.

---

## Favourite Authors — State Management

Favourite authors are stored in **`localStorage`** under the key `"favAuthors"`
as a JSON array of author name strings.

Rationale: favourites are a UI preference that doesn't need to be synced to the
Google Sheet or shared between devices.  `localStorage` is instant, survives
page reloads, and requires no backend changes.

The `favAuthors` state lives in `Home.tsx` and is passed down as `isFav` /
`onToggleFav` props to each `FicCard`.  This keeps the source of truth in one
place and avoids prop-drilling through a context.

---

## Type Safety Chain

```
Zod schemas (@workspace/api-zod)
    └── used in Express routes for request/response validation
    └── used by openapi-codegen to generate TypeScript types
            └── consumed by @workspace/api-client-react (TanStack Query hooks)
                    └── imported by React components for typed API calls
```

This means a change to the API schema propagates through to the frontend types
automatically after running `pnpm codegen`.

---

## Sensitive Files

`artifacts/api-server/data/sheet-id.txt` contains the Google Spreadsheet ID and
is listed in `.gitignore`.  It is created automatically on first run and should
never be committed or shared publicly.
