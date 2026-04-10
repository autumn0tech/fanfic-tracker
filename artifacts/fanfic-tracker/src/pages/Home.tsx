/**
 * Home.tsx — main reading log page
 *
 * Responsibilities:
 *  1. Detect the bookmarklet redirect (?import=<json>) on mount and save the fic.
 *  2. Render the stats header card:
 *       - Monthly fic/fandom counts
 *       - Reading streak (consecutive days with at least one fic logged)
 *       - Tag word cloud (top 10 most-frequent tags this month)
 *       - Favourite authors section (authors with 5+ fics; heart-toggle chips)
 *  3. Render the full fic list as FicCard components, with staggered entrance animation.
 *  4. Provide the "Setup bookmark" dialog explaining how to install the bookmarklet
 *     on desktop (drag-and-drop) and mobile (copy-paste URL).
 *
 * State owned here:
 *  favAuthors  — Set<string> persisted to localStorage; passed to FicCard as isFav/onToggleFav
 *  setupTab    — "desktop" | "mobile" controls which instructions are shown in the dialog
 *  copied      — short-lived boolean to show a "Copied!" checkmark after clipboard write
 */

import { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  useListFics,
  useGetMonthlyStats,
  useCreateFic,
  getListFicsQueryKey,
  getGetMonthlyStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { FicCard } from "@/components/FicCard";
import {
  BookOpen,
  Sparkles,
  BookmarkPlus,
  GripHorizontal,
  Copy,
  Check,
  Monitor,
  Smartphone,
  Flame,
  Heart,
  BookText,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// ─── Bookmarklet builder ──────────────────────────────────────────────────────

/**
 * Builds the full `javascript:` URL that becomes the bookmarklet.
 *
 * The generated code runs entirely in the AO3 page context (no network calls),
 * reads metadata from the DOM, and redirects the browser to:
 *   <appPageUrl>?import=<url-encoded-json>
 *
 * The app then picks up that query parameter on mount and saves the fic.
 *
 * Minification note: the code is written as a single concatenated string so the
 * resulting `javascript:` URL contains no newlines (some browsers reject multi-line
 * javascript: bookmarks).
 */
function buildBookmarkletHref(appPageUrl: string): string {
  const code =
    `(function(){` +
    // Guard: only run on AO3 work pages
    `var loc=window.location.href;` +
    `if(loc.indexOf('archiveofourown.org/works/')===-1){alert('Please open an AO3 work page first, then click this bookmark.');return;}` +
    // Guard: ensure the metadata elements exist (won't be present on chapter pages)
    `var t=document.querySelector('h2.title.heading');` +
    `if(!t){alert('Could not read fic metadata. Make sure you are on the main work page, not inside a chapter.');return;}` +
    // Scrape metadata from the AO3 work page DOM
    `var au=document.querySelector('[rel=author]')||document.querySelector('.byline a');` +
    `var fd=[].slice.call(document.querySelectorAll('dd.fandom.tags a.tag')).map(function(el){return el.textContent.trim();});` +
    `var sh=[].slice.call(document.querySelectorAll('dd.relationship.tags a.tag')).map(function(el){return el.textContent.trim();});` +
    `var wc=document.querySelector('dd.words');` +
    `var tg=[].slice.call(document.querySelectorAll('dd.freeform.tags a.tag')).map(function(el){return el.textContent.trim();});` +
    // Normalise URL: strip query string, hash, and /chapters/... so multi-chapter
    // works always store the canonical work URL
    `var url=loc.split('?')[0].split('#')[0];` +
    `var ci=url.indexOf('/chapters/');if(ci!==-1)url=url.slice(0,ci);` +
    // Build the data payload — fandoms joined as comma-separated string
    `var data={url:url,title:t.textContent.trim(),author:au?au.textContent.trim():'Anonymous',fandom:fd.join(', ')||'Unknown',ship:sh.length?sh.join(', '):null,wordCount:wc?(parseInt(wc.textContent.trim().replace(/,/g,''),10)||0):0,tags:tg,userRating:null,userNote:null};` +
    // Redirect to the app with the JSON payload in the query string
    `window.location.href='${appPageUrl}?import='+encodeURIComponent(JSON.stringify(data));` +
    `})()`;
  return "javascript:" + code;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a raw word count into a compact, readable string.
 *   0–999        → "873"
 *   1,000–999,999 → "143k"
 *   1,000,000+   → "1.2m"
 */
function formatWords(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return n.toString();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const { data: fics, isLoading: isLoadingFics } = useListFics();
  const { data: stats, isLoading: isLoadingStats } = useGetMonthlyStats();
  const createFic = useCreateFic();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Prevents the import handler from running twice in React StrictMode
  const importHandled = useRef(false);

  const [setupTab, setSetupTab] = useState<"desktop" | "mobile">("desktop");
  const [copied, setCopied] = useState(false);

  // ── Favourite authors ───────────────────────────────────────────────────────
  // Stored in localStorage so they persist across page reloads without
  // needing a backend change.  Initialised lazily from localStorage.
  const [favAuthors, setFavAuthors] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("favAuthors");
      return new Set(stored ? (JSON.parse(stored) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  /** Toggles the given author in the favourite set and syncs to localStorage. */
  function toggleFav(author: string) {
    setFavAuthors((prev) => {
      const next = new Set(prev);
      if (next.has(author)) next.delete(author);
      else next.add(author);
      localStorage.setItem("favAuthors", JSON.stringify([...next]));
      return next;
    });
  }

  // ── Bookmarklet ─────────────────────────────────────────────────────────────

  // Compute the bookmarklet href once (depends on the current page origin/path).
  // Trailing slash is stripped to avoid double-slash issues on some hosts.
  const bookmarkletHref = useMemo(() => {
    const base =
      window.location.origin + window.location.pathname.replace(/\/$/, "");
    return buildBookmarkletHref(base);
  }, []);

  // React sanitises `javascript:` hrefs set via JSX props (as an XSS safeguard).
  // Work-around: use a callback ref to call setAttribute() directly on the DOM node
  // after it mounts, bypassing React's sanitisation for this explicitly-built value.
  const bookmarkletAnchorRef = useCallback(
    (node: HTMLAnchorElement | null) => {
      if (node) node.setAttribute("href", bookmarkletHref);
    },
    [bookmarkletHref],
  );

  // ── Bookmarklet import handler ──────────────────────────────────────────────
  // When the bookmarklet redirects the browser back to the app it appends
  // ?import=<url-encoded-json> to the URL.  This effect detects that parameter,
  // POSTs the fic to the API, then removes the parameter from the URL so the
  // user's back-button history stays clean.
  useEffect(() => {
    if (importHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("import");
    if (!raw) return;
    importHandled.current = true;
    // Remove the ?import=... parameter without adding a new history entry
    window.history.replaceState({}, "", window.location.pathname);

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(decodeURIComponent(raw));
    } catch {
      toast({ title: "Could not read fic data", variant: "destructive" });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createFic.mutate(
      { data: data as any },
      {
        onSuccess: (fic: { title: string }) => {
          toast({ title: "Fic saved to your log", description: fic.title });
          // Invalidate both the list and the stats so they reload with the new fic
          queryClient.invalidateQueries({ queryKey: getListFicsQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getGetMonthlyStatsQueryKey(),
          });
        },
        onError: (err: Error) => {
          toast({
            title: "Could not save fic",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  }, []);

  // ── Derived data (memoised) ─────────────────────────────────────────────────

  /**
   * Tag word cloud — current month's fics only.
   * Aggregates all freeform tags, filters to those appearing more than once
   * (single-use tags add noise), sorts by frequency desc, and takes the top 10.
   * Font size and opacity are scaled by frequency in the render section.
   */
  const fandomCloud = useMemo(() => {
    if (!fics?.length) return [] as { name: string; count: number }[];
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const freq: Record<string, number> = {};
    fics
      .filter((f) => f.dateAdded?.startsWith(currentMonth))
      .forEach((fic) => {
        (fic.tags ?? []).forEach((tag: string) => {
          if (tag?.trim()) freq[tag.trim()] = (freq[tag.trim()] || 0) + 1;
        });
      });
    return Object.entries(freq)
      .filter(([, count]) => count > 1)   // exclude tags that only appear once
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [fics]);

  /**
   * Reading streak — all-time consecutive days with at least one fic logged.
   *
   * Algorithm:
   *  1. Build a Set of all unique dates (YYYY-MM-DD) from the reading log.
   *  2. If neither today nor yesterday is in the set, the streak is 0 (broken).
   *  3. Otherwise, walk backwards from whichever of today/yesterday has an entry,
   *     counting each day that appears in the set, until a gap is found.
   *
   * The "today or yesterday" grace period means logging before midnight and
   * after midnight on the same real day doesn't break the streak.
   */
  const streak = useMemo(() => {
    if (!fics?.length) return 0;
    const dates = new Set(
      fics.map((f) => f.dateAdded?.slice(0, 10)).filter(Boolean),
    );
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterdayStr = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);

    if (!dates.has(todayStr) && !dates.has(yesterdayStr)) return 0;

    // Start counting from the most recent logged day (today or yesterday)
    let cursor = new Date(
      (dates.has(todayStr) ? todayStr : yesterdayStr) + "T12:00:00Z",
    );
    let count = 0;
    while (dates.has(cursor.toISOString().slice(0, 10))) {
      count++;
      cursor = new Date(cursor.getTime() - 86_400_000); // step back one day
    }
    return count;
  }, [fics]);

  /**
   * Author stats — all authors derived from the full fic list.
   * Sorted so favourited authors appear first, then by fic count descending.
   * The header only renders authors with 5+ fics; this memo computes the
   * full sorted list so the sort order is consistent if the threshold changes.
   */
  const authorStats = useMemo(() => {
    if (!fics?.length) return [] as { name: string; count: number }[];
    const freq: Record<string, number> = {};
    fics.forEach((fic) => {
      if (fic.author) freq[fic.author] = (freq[fic.author] || 0) + 1;
    });
    return Object.entries(freq)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        const aFav = favAuthors.has(a.name);
        const bFav = favAuthors.has(b.name);
        // Favourites bubble to the top regardless of count
        if (aFav !== bFav) return aFav ? -1 : 1;
        return b.count - a.count;
      });
  }, [fics, favAuthors]);

  // Highest frequency in the word cloud — used to normalise font/opacity scaling
  const maxFandomCount = fandomCloud[0]?.count ?? 1;

  /** Copies the raw bookmarklet href to the clipboard (mobile setup flow). */
  function copyBookmarklet() {
    navigator.clipboard.writeText(bookmarkletHref).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-[100dvh] pb-24">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="bg-card border-b border-border/50 py-10 px-4 mb-8">
        <div className="max-w-3xl mx-auto">

          {/* Title row + Setup bookmark button */}
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
                <BookOpen className="w-6 h-6" />
              </div>
              <h1 className="font-serif text-3xl font-bold text-foreground">
                Reading Log
              </h1>
            </div>

            {/* Bookmarklet setup dialog */}
            <Dialog>
              <DialogTrigger asChild>
                <button
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border/60"
                  data-testid="setup-trigger"
                >
                  <BookmarkPlus className="w-4 h-4" />
                  <span className="hidden sm:inline">Setup bookmark</span>
                </button>
              </DialogTrigger>

              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="font-serif text-xl flex items-center gap-2">
                    <BookmarkPlus className="w-5 h-5 text-primary" />
                    Save fics while you browse
                  </DialogTitle>
                </DialogHeader>

                <p className="text-sm text-muted-foreground -mt-1">
                  One tap on any AO3 page saves it to your log automatically.
                </p>

                {/* Desktop / Mobile tab switcher */}
                <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
                  <button
                    onClick={() => setSetupTab("desktop")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      setupTab === "desktop"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    Desktop
                  </button>
                  <button
                    onClick={() => setSetupTab("mobile")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      setupTab === "mobile"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    Mobile
                  </button>
                </div>

                {/* Desktop instructions: drag bookmarklet to bookmarks bar */}
                {setupTab === "desktop" ? (
                  <div className="space-y-5">
                    <ol className="space-y-3 text-sm">
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          1
                        </span>
                        <span className="text-foreground/80">
                          Show your bookmarks bar:{" "}
                          <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-xs">
                            Ctrl+Shift+B
                          </kbd>{" "}
                          on Windows /{" "}
                          <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-xs">
                            ⌘+Shift+B
                          </kbd>{" "}
                          on Mac.
                        </span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          2
                        </span>
                        <span className="text-foreground/80">
                          <strong>Drag</strong> the button below into your
                          bookmarks bar — or right-click it and choose{" "}
                          <em>Bookmark this link</em>.
                        </span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          3
                        </span>
                        <span className="text-foreground/80">
                          On any AO3 work page, click{" "}
                          <strong>Save to Reading Log</strong> in your bookmarks
                          bar. You'll be brought back here with the fic saved.
                        </span>
                      </li>
                    </ol>

                    {/* Draggable bookmarklet anchor.
                        The href is set via the callback ref (not JSX) because React
                        strips javascript: hrefs as an XSS safeguard.
                        onClick shows an alert to prevent accidental navigation when
                        the user clicks instead of drags. */}
                    <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/50 rounded-xl border border-dashed border-primary/40">
                      <GripHorizontal className="w-4 h-4 text-muted-foreground shrink-0" />
                      <a
                        ref={bookmarkletAnchorRef}
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          alert(
                            "Drag this link to your bookmarks bar — don't click it here.",
                          );
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium cursor-grab active:cursor-grabbing select-none hover:bg-primary/90 transition-colors"
                        data-testid="bookmarklet-link"
                        draggable
                      >
                        <BookmarkPlus className="w-4 h-4" />
                        Save to Reading Log
                      </a>
                      <span className="text-xs text-muted-foreground">
                        ← drag to bookmarks bar
                      </span>
                    </div>
                  </div>
                ) : (
                  /* Mobile instructions: copy the javascript: URL and paste into a bookmark */
                  <div className="space-y-5">
                    <ol className="space-y-3 text-sm">
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          1
                        </span>
                        <span className="text-foreground/80">
                          Tap <strong>Copy bookmark code</strong> below to copy
                          the special bookmark URL.
                        </span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          2
                        </span>
                        <span className="text-foreground/80">
                          In Safari or Chrome, bookmark <em>any</em> page. Then
                          open your bookmarks list, find that bookmark, tap{" "}
                          <strong>Edit</strong>, and paste the copied code into
                          the <strong>URL / Address</strong> field. Name it{" "}
                          &ldquo;Save to Reading Log&rdquo;.
                        </span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          3
                        </span>
                        <span className="text-foreground/80">
                          On any AO3 work page, open your bookmarks and tap{" "}
                          <strong>Save to Reading Log</strong>. The page
                          redirects here with the fic saved — tap Back to return
                          to AO3.
                        </span>
                      </li>
                    </ol>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={copyBookmarklet}
                        className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors w-fit"
                        data-testid="copy-bookmarklet"
                      >
                        {copied ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy bookmark code
                          </>
                        )}
                      </button>
                      <p className="text-xs text-muted-foreground/70">
                        Works in Safari and Chrome on iPhone and Android.
                      </p>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>

          {/* ── Stats card ──────────────────────────────────────────────────── */}
          <div className="bg-background rounded-2xl p-6 border border-border/40 shadow-sm">

            {/* Monthly summary row */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between mb-5">
              <div>
                <p className="text-muted-foreground font-medium text-sm mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-primary/60" />
                  This Month&apos;s Reading
                </p>
                {isLoadingStats ? (
                  <div className="space-y-2 mt-2">
                    <div className="h-8 w-48 bg-muted animate-pulse rounded" />
                    <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                  </div>
                ) : (
                  <>
                    <p className="font-serif text-2xl text-foreground">
                      <strong className="text-primary">
                        {stats?.ficCount || 0}
                      </strong>{" "}
                      fics across{" "}
                      <strong className="text-primary">
                        {stats?.fandomCount || 0}
                      </strong>{" "}
                      fandoms
                    </p>
                    {(stats?.totalWords ?? 0) > 0 && (
                      <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                        <BookText className="w-3.5 h-3.5 shrink-0 text-primary/50" />
                        <strong className="text-foreground font-medium">
                          {formatWords(stats!.totalWords)}
                        </strong>{" "}
                        words read
                      </p>
                    )}
                  </>
                )}
              </div>

              <div className="flex items-center gap-4 shrink-0">
                {/* Reading streak badge — hidden when streak is 0 */}
                {!isLoadingFics && streak > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-orange-50 dark:bg-orange-950/30 border border-orange-200/60 dark:border-orange-800/40">
                    <Flame className="w-4 h-4 text-orange-500" />
                    <span className="font-bold text-orange-600 dark:text-orange-400 text-sm">
                      {streak}
                    </span>
                    <span className="text-xs text-orange-500/80 dark:text-orange-400/70">
                      day streak
                    </span>
                  </div>
                )}
                {/* Current month label — parsed from the stats response or derived from Date() */}
                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wider hidden sm:block">
                  {stats?.month
                    ? new Date(stats.month + "-02").toLocaleString("default", {
                        month: "long",
                        year: "numeric",
                      })
                    : new Date().toLocaleString("default", {
                        month: "long",
                        year: "numeric",
                      })}
                </div>
              </div>
            </div>

            {/* Tag word cloud — only shown when there are qualifying tags */}
            {fandomCloud.length > 0 && (
              <div className="border-t border-border/30 pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Tags this month
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-2 items-baseline">
                  {fandomCloud.map(({ name, count }) => {
                    // Normalise count to 0–1 range so all tags scale proportionally.
                    // ratio = 0 for the least frequent, 1 for the most frequent.
                    const ratio = maxFandomCount > 1
                      ? (count - 1) / (maxFandomCount - 1)
                      : 1;
                    // Font size: 0.78rem (min) → 1.45rem (max)
                    const size = 0.78 + ratio * 0.67;
                    // Opacity: 0.55 (min) → 1.0 (max)
                    const opacity = 0.55 + ratio * 0.45;
                    return (
                      <span
                        key={name}
                        title={`${count} fic${count !== 1 ? "s" : ""}`}
                        style={{
                          fontSize: `${size}rem`,
                          opacity,
                          lineHeight: "1.4",
                        }}
                        className="font-medium text-primary cursor-default transition-opacity hover:opacity-100 bg-primary/10 px-2 py-0.5 rounded-full"
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Favourite authors — only explicitly hearted authors */}
            {favAuthors.size > 0 && (
              <div className="border-t border-border/30 pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Favorite Authors
                </p>
                <div className="flex flex-wrap gap-2">
                  {[...favAuthors].sort().map((name) => {
                    const count = authorStats.find((a) => a.name === name)?.count ?? 0;
                    return (
                      // Clicking the chip un-favourites the author.
                      <button
                        key={name}
                        onClick={() => toggleFav(name)}
                        title="Remove from favorites"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors bg-primary text-primary-foreground border-primary"
                      >
                        <Heart className="w-3.5 h-3.5 shrink-0 fill-current" />
                        {name}
                        <span className="text-xs text-primary-foreground/70">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Skeleton placeholder shown while fics are loading */}
            {isLoadingFics && (
              <div className="border-t border-border/30 pt-4">
                <div className="flex gap-3 flex-wrap">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Fic List ─────────────────────────────────────────────────────────── */}
      <main className="max-w-3xl mx-auto px-4">
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-border/40 pb-4">
            <h2 className="font-serif text-2xl font-semibold text-foreground">
              Saved Fics
            </h2>
            <span className="text-sm font-medium text-muted-foreground">
              {fics?.length || 0} entries
            </span>
          </div>

          {/* Loading skeleton — three placeholder cards */}
          {isLoadingFics ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-card rounded-xl p-6 border border-border/50"
                >
                  <Skeleton className="h-7 w-3/4 mb-3" />
                  <Skeleton className="h-4 w-1/3 mb-6" />
                  <Skeleton className="h-5 w-full mb-2" />
                  <Skeleton className="h-5 w-2/3" />
                </div>
              ))}
            </div>
          ) : fics?.length === 0 ? (
            /* Empty state — shown when the log has no entries yet */
            <div
              className="text-center py-20 bg-card rounded-2xl border border-border/50 border-dashed"
              data-testid="empty-state"
            >
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4 text-muted-foreground/50">
                <BookOpen className="w-8 h-8" />
              </div>
              <h3 className="font-serif text-xl font-medium text-foreground mb-2">
                Your log is empty
              </h3>
              <p className="text-muted-foreground max-w-sm mx-auto">
                Use the{" "}
                <span className="text-primary font-medium">Setup bookmark</span>{" "}
                button above to start saving fics from AO3.
              </p>
            </div>
          ) : (
            /* Fic list — each card entrance is staggered by 50ms for a cascade effect */
            <div className="space-y-4" data-testid="fics-list">
              {fics?.map((fic, i) => (
                <motion.div
                  key={fic.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                >
                  <FicCard
                    fic={fic}
                    isFav={favAuthors.has(fic.author)}
                    onToggleFav={() => toggleFav(fic.author)}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
