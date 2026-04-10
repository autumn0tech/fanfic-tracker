/**
 * FicDetail.tsx — individual fic page
 *
 * Displays the full metadata for a single fic and lets the user:
 *  - Rate it 1–5 stars
 *  - Write a personal journal note
 *  - Delete it from the log entirely
 *
 * The fic ID comes from the URL parameter /fics/:id (via wouter).
 *
 * Edit state:
 *  The page starts in read mode.  Clicking "Edit Notes" or touching a star
 *  enters edit mode.  "Save Journal" commits the changes to the API; "Cancel"
 *  discards them.  After a successful save the query cache is updated optimistically
 *  so the page reflects the new values immediately without a full refetch.
 *
 * Delete flow:
 *  Clicking "Remove from Log" opens a confirmation AlertDialog to prevent
 *  accidental deletions.  On confirm the fic is deleted via the API and the
 *  user is navigated back to the home page.
 */

import React, { useState, useEffect, useRef } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { 
  useGetFic, 
  useUpdateFic, 
  useDeleteFic,
  getGetFicQueryKey,
  getListFicsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, ExternalLink, Trash2, Calendar, BookOpen, Users, Tag as TagIcon, Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/StarRating";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

export default function FicDetail() {
  // Extract the fic ID from the URL — wouter returns null params when no match
  const [, params] = useRoute("/fics/:id");
  const id = params?.id || "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch the fic; skip the query entirely if we somehow have no ID
  const { data: fic, isLoading, isError } = useGetFic(id, { 
    query: { enabled: !!id, queryKey: getGetFicQueryKey(id) } 
  });
  
  const updateFic = useUpdateFic();
  const deleteFic = useDeleteFic();

  // Local edit state — mirrors the fic's persisted values initially
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);

  // Track which fic ID we've already initialised state for.
  // Without this guard, the state would reset every time the fic data re-renders
  // (e.g. after a successful save triggers a cache update).
  const initializedForId = useRef<string | null>(null);

  useEffect(() => {
    if (fic && initializedForId.current !== id) {
      initializedForId.current = id;
      setRating(fic.userRating ?? null);
      setNote(fic.userNote ?? "");
    }
  }, [fic, id]);

  /**
   * Persist the current rating and note to the API.
   * On success: update the TanStack Query cache directly (optimistic) so the
   * UI reflects the change immediately, then exit edit mode.
   */
  const handleSave = async () => {
    if (!id) return;
    
    try {
      await updateFic.mutateAsync({
        id,
        data: {
          userRating: rating,
          userNote: note.trim() || null   // treat blank string as no note
        }
      });
      
      // Patch the cached fic object rather than triggering a full refetch
      queryClient.setQueryData(getGetFicQueryKey(id), (old: any) => 
        old ? { ...old, userRating: rating, userNote: note.trim() || null } : old
      );
      
      setIsEditing(false);
      toast({ title: "Notes saved successfully" });
    } catch (error) {
      toast({
        title: "Failed to save",
        description: "Please try again later.",
        variant: "destructive"
      });
    }
  };

  /**
   * Delete the fic via the API, invalidate the list cache so the home page
   * no longer shows it, then navigate back to the home page.
   */
  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteFic.mutateAsync({ id });
      toast({ title: "Fic deleted from log" });
      // Invalidate the list so the home page re-fetches without this fic
      queryClient.invalidateQueries({ queryKey: getListFicsQueryKey() });
      setLocation("/");
    } catch (error) {
      toast({
        title: "Failed to delete",
        variant: "destructive"
      });
    }
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Skeleton className="h-8 w-24 mb-8" />
        <Skeleton className="h-12 w-3/4 mb-4" />
        <Skeleton className="h-6 w-1/3 mb-8" />
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  // ── Not found / error ─────────────────────────────────────────────────────
  if (isError || !fic) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-serif font-bold mb-4">Fic not found</h2>
        <Button onClick={() => setLocation("/")}>Return to Log</Button>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-24 bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* Back navigation */}
        <Link href="/">
          <Button variant="ghost" size="sm" className="mb-6 -ml-3 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Log
          </Button>
        </Link>

        {/* Fic header — title, author, link to AO3 */}
        <div className="mb-10">
          <h1 className="font-serif text-3xl sm:text-4xl font-bold text-foreground mb-3 leading-tight">
            {fic.title}
          </h1>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <p className="text-lg text-muted-foreground font-medium">
              by {fic.author}
            </p>
            <a 
              href={fic.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80 transition-colors bg-primary/10 px-3 py-1.5 rounded-full"
              data-testid="link-ao3"
            >
              Read on AO3 <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
            </a>
          </div>
        </div>

        {/* Metadata grid — fandom, ship, word count, date saved */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          <div className="bg-card border border-border/50 rounded-xl p-4 flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" /> Fandom
            </span>
            <span className="font-medium text-foreground">{fic.fandom}</span>
          </div>
          {fic.ship && (
            <div className="bg-card border border-border/50 rounded-xl p-4 flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Ship
              </span>
              <span className="font-medium text-foreground">{fic.ship}</span>
            </div>
          )}
          <div className="bg-card border border-border/50 rounded-xl p-4 flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TagIcon className="w-3.5 h-3.5" /> Length
            </span>
            <span className="font-mono text-sm text-foreground">
              {new Intl.NumberFormat('en-US').format(fic.wordCount)} words
            </span>
          </div>
          <div className="bg-card border border-border/50 rounded-xl p-4 flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" /> Saved On
            </span>
            <span className="font-medium text-foreground">
              {format(new Date(fic.dateAdded), 'MMMM d, yyyy')}
            </span>
          </div>
        </div>

        {/* Full tag list */}
        {fic.tags && fic.tags.length > 0 && (
          <div className="mb-12">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {fic.tags.map(tag => (
                <Badge key={tag} variant="secondary" className="font-normal bg-secondary/60 hover:bg-secondary/80">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <hr className="border-border/60 my-10" />

        {/* Personal journal section — rating + free-text note */}
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-serif text-2xl font-semibold text-foreground">Personal Journal</h2>
            {/* Only show "Edit Notes" button when not already editing */}
            {!isEditing && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setIsEditing(true)}
                data-testid="btn-edit-journal"
              >
                Edit Notes
              </Button>
            )}
          </div>

          <div className="space-y-8">
            {/* Star rating — touching a star auto-enters edit mode */}
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-3">Your Rating</label>
              <StarRating 
                rating={rating} 
                onRatingChange={(r) => { setRating(r); setIsEditing(true); }}
                readOnly={!isEditing && rating !== null}
                size={32}
              />
            </div>

            {/* Free-text note — textarea in edit mode, plain text in read mode */}
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-3">Your Thoughts</label>
              {isEditing ? (
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="How did this fic make you feel? What were your favorite parts?"
                  className="min-h-[160px] bg-background border-border/80 focus-visible:ring-primary resize-y text-base p-4"
                  data-testid="textarea-note"
                />
              ) : (
                <div className="min-h-[100px] text-foreground/90 whitespace-pre-wrap leading-relaxed">
                  {note ? note : <span className="text-muted-foreground italic">No notes yet. Click edit to add your thoughts.</span>}
                </div>
              )}
            </div>

            {/* Save / Cancel actions — only visible in edit mode */}
            {isEditing && (
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/50">
                <Button 
                  variant="ghost" 
                  onClick={() => {
                    // Discard local changes and restore from the last fetched fic
                    setRating(fic.userRating ?? null);
                    setNote(fic.userNote ?? "");
                    setIsEditing(false);
                  }}
                  disabled={updateFic.isPending}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleSave}
                  disabled={updateFic.isPending}
                  className="px-6"
                  data-testid="btn-save-journal"
                >
                  {updateFic.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                  Save Journal
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Delete section — behind a confirmation dialog */}
        <div className="mt-16 pt-8 border-t border-border/40 flex justify-center">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive transition-colors">
                <Trash2 className="w-4 h-4 mr-2" />
                Remove from Log
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this fic from your log?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove "{fic.title}" and your personal notes from your reading log. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={handleDelete}
                  className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  data-testid="btn-confirm-delete"
                >
                  {deleteFic.isPending ? "Deleting..." : "Delete Fic"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

      </div>
    </div>
  );
}
