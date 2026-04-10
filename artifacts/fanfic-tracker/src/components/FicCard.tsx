import { Link } from "wouter";
import { format } from "date-fns";
import { BookOpen, Calendar, Tag as TagIcon, Users, Heart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "./StarRating";
import type { Fic } from "@workspace/api-client-react";

interface FicCardProps {
  fic: Fic;
  isFav?: boolean;
  onToggleFav?: () => void;
}

export function FicCard({ fic, isFav, onToggleFav }: FicCardProps) {
  return (
    <Link href={`/fics/${fic.id}`} className="block group" data-testid={`fic-card-${fic.id}`}>
      <div className="bg-card border border-border/50 hover:border-primary/30 rounded-xl p-5 sm:p-6 transition-all duration-300 shadow-sm hover:shadow-md hover:-translate-y-0.5">
        
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="font-serif text-xl sm:text-2xl font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2">
              {fic.title}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-muted-foreground font-medium">by {fic.author}</p>
              {onToggleFav && (
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFav(); }}
                  title={isFav ? "Remove from favourites" : "Favourite this author"}
                  className={`transition-colors ${isFav ? "text-primary" : "text-muted-foreground/40 hover:text-primary/70"}`}
                >
                  <Heart className={`w-3.5 h-3.5 ${isFav ? "fill-current" : ""}`} />
                </button>
              )}
            </div>
          </div>
          {fic.userRating && (
            <div className="shrink-0 bg-accent/50 rounded-full px-2 py-1">
              <StarRating rating={fic.userRating} readOnly size={16} className="gap-0.5" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground mb-4">
          <div className="flex items-center gap-1.5" data-testid={`fic-fandom-${fic.id}`}>
            <BookOpen className="w-4 h-4 text-primary/70" />
            <span className="font-medium text-foreground/80">{fic.fandom}</span>
          </div>
          
          {fic.ship && (
            <div className="flex items-center gap-1.5" data-testid={`fic-ship-${fic.id}`}>
              <Users className="w-4 h-4 text-primary/70" />
              <span>{fic.ship}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground/70">
              {new Intl.NumberFormat('en-US').format(fic.wordCount)} words
            </span>
          </div>
        </div>

        {fic.tags && fic.tags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <TagIcon className="w-3.5 h-3.5 text-muted-foreground/70" />
            {fic.tags.slice(0, 5).map((tag) => (
              <Badge key={tag} variant="secondary" className="font-normal text-xs bg-secondary/50 text-secondary-foreground/80">
                {tag}
              </Badge>
            ))}
            {fic.tags.length > 5 && (
              <span className="text-xs text-muted-foreground font-medium">
                +{fic.tags.length - 5} more
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/30">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="w-3.5 h-3.5" />
            <span>Saved {format(new Date(fic.dateAdded), 'MMM d, yyyy')}</span>
          </div>
          
          {fic.userNote && (
            <div className="text-xs font-medium text-primary/80 italic line-clamp-1 max-w-[50%]">
              "{fic.userNote}"
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
