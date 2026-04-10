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
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function buildBookmarkletHref(appPageUrl: string): string {
  const code =
    `(function(){` +
    `var loc=window.location.href;` +
    `if(loc.indexOf('archiveofourown.org/works/')===-1){alert('Please open an AO3 work page first, then click this bookmark.');return;}` +
    `var t=document.querySelector('h2.title.heading');` +
    `if(!t){alert('Could not read fic metadata. Make sure you are on the main work page, not inside a chapter.');return;}` +
    `var au=document.querySelector('[rel=author]')||document.querySelector('.byline a');` +
    `var fd=[].slice.call(document.querySelectorAll('dd.fandom.tags a.tag')).map(function(el){return el.textContent.trim();});` +
    `var sh=[].slice.call(document.querySelectorAll('dd.relationship.tags a.tag')).map(function(el){return el.textContent.trim();});` +
    `var wc=document.querySelector('dd.words');` +
    `var tg=[].slice.call(document.querySelectorAll('dd.freeform.tags a.tag')).map(function(el){return el.textContent.trim();});` +
    `var url=loc.split('?')[0].split('#')[0];` +
    `var ci=url.indexOf('/chapters/');if(ci!==-1)url=url.slice(0,ci);` +
    `var data={url:url,title:t.textContent.trim(),author:au?au.textContent.trim():'Anonymous',fandom:fd.join(', ')||'Unknown',ship:sh.length?sh.join(', '):null,wordCount:wc?(parseInt(wc.textContent.trim().replace(/,/g,''),10)||0):0,tags:tg,userRating:null,userNote:null};` +
    `window.location.href='${appPageUrl}?import='+encodeURIComponent(JSON.stringify(data));` +
    `})()`;
  return "javascript:" + code;
}

export default function Home() {
  const { data: fics, isLoading: isLoadingFics } = useListFics();
  const { data: stats, isLoading: isLoadingStats } = useGetMonthlyStats();
  const createFic = useCreateFic();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const importHandled = useRef(false);
  const [setupTab, setSetupTab] = useState<"desktop" | "mobile">("desktop");
  const [copied, setCopied] = useState(false);

  // Favourite authors stored in localStorage (no backend needed)
  const [favAuthors, setFavAuthors] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("favAuthors");
      return new Set(stored ? (JSON.parse(stored) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  function toggleFav(author: string) {
    setFavAuthors((prev) => {
      const next = new Set(prev);
      if (next.has(author)) next.delete(author);
      else next.add(author);
      localStorage.setItem("favAuthors", JSON.stringify([...next]));
      return next;
    });
  }

  const bookmarkletHref = useMemo(() => {
    const base =
      window.location.origin + window.location.pathname.replace(/\/$/, "");
    return buildBookmarkletHref(base);
  }, []);

  // React blocks javascript: hrefs — set the attribute directly on the DOM node.
  const bookmarkletAnchorRef = useCallback(
    (node: HTMLAnchorElement | null) => {
      if (node) node.setAttribute("href", bookmarkletHref);
    },
    [bookmarkletHref],
  );

  // Detect ?import=<json> from the bookmarklet redirect and save the fic.
  useEffect(() => {
    if (importHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("import");
    if (!raw) return;
    importHandled.current = true;
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

  // Tag word cloud — current month only, aggregated from all fic tags, sorted by frequency.
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
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [fics]);

  // Reading streak — consecutive calendar days (all-time) with at least one fic logged.
  // Streak stays alive if today or yesterday has an entry.
  const streak = useMemo(() => {
    if (!fics?.length) return 0;
    const dates = new Set(
      fics.map((f) => f.dateAdded?.slice(0, 10)).filter(Boolean),
    );
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterdayStr = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);

    // If neither today nor yesterday has a log, streak is broken.
    if (!dates.has(todayStr) && !dates.has(yesterdayStr)) return 0;

    // Start counting from whichever of today/yesterday has an entry.
    let cursor = new Date(
      (dates.has(todayStr) ? todayStr : yesterdayStr) + "T12:00:00Z",
    );
    let count = 0;
    while (dates.has(cursor.toISOString().slice(0, 10))) {
      count++;
      cursor = new Date(cursor.getTime() - 86_400_000);
    }
    return count;
  }, [fics]);

  // Authors derived from log, sorted favourites-first then by fic count.
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
        if (aFav !== bFav) return aFav ? -1 : 1;
        return b.count - a.count;
      });
  }, [fics, favAuthors]);

  const maxFandomCount = fandomCloud[0]?.count ?? 1;

  function copyBookmarklet() {
    navigator.clipboard.writeText(bookmarkletHref).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="min-h-[100dvh] pb-24">
      {/* Header */}
      <header className="bg-card border-b border-border/50 py-10 px-4 mb-8">
        <div className="max-w-3xl mx-auto">
          {/* Title row */}
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
                <BookOpen className="w-6 h-6" />
              </div>
              <h1 className="font-serif text-3xl font-bold text-foreground">
                Reading Log
              </h1>
            </div>

            {/* Setup modal trigger */}
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

          {/* Stats bar */}
          <div className="bg-background rounded-2xl p-6 border border-border/40 shadow-sm">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between mb-5">
              <div>
                <p className="text-muted-foreground font-medium text-sm mb-1 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-primary/60" />
                  This Month&apos;s Reading
                </p>
                {isLoadingStats ? (
                  <div className="h-8 w-48 bg-muted animate-pulse rounded mt-2" />
                ) : (
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
                )}
              </div>

              <div className="flex items-center gap-4 shrink-0">
                {/* Streak counter */}
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

            {/* Fandom word cloud */}
            {fandomCloud.length > 0 && (
              <div className="border-t border-border/30 pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Tags this month
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-2 items-baseline">
                  {fandomCloud.map(({ name, count }) => {
                    // Scale font size between 0.78rem and 1.45rem based on frequency
                    const ratio = maxFandomCount > 1
                      ? (count - 1) / (maxFandomCount - 1)
                      : 1;
                    const size = 0.78 + ratio * 0.67;
                    // Scale opacity between 0.55 and 1
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
            {/* Authors — only those with 5+ fics logged */}
            {authorStats.filter((a) => a.count >= 5).length > 0 && (
              <div className="border-t border-border/30 pt-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                  Authors
                </p>
                <div className="flex flex-wrap gap-2">
                  {authorStats.filter((a) => a.count >= 5).map(({ name, count }) => {
                    const isFav = favAuthors.has(name);
                    return (
                      <button
                        key={name}
                        onClick={() => toggleFav(name)}
                        title={`${count} fic${count !== 1 ? "s" : ""} logged`}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          isFav
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-foreground border-border/60 hover:border-primary/50 hover:bg-primary/5"
                        }`}
                      >
                        <Heart
                          className={`w-3.5 h-3.5 shrink-0 ${isFav ? "fill-current" : ""}`}
                        />
                        {name}
                        <span
                          className={`text-xs ${isFav ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
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

      <main className="max-w-3xl mx-auto px-4">
        {/* Fics List */}
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-border/40 pb-4">
            <h2 className="font-serif text-2xl font-semibold text-foreground">
              Saved Fics
            </h2>
            <span className="text-sm font-medium text-muted-foreground">
              {fics?.length || 0} entries
            </span>
          </div>

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
