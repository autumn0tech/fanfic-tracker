import React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  rating: number | null;
  onRatingChange?: (rating: number) => void;
  readOnly?: boolean;
  className?: string;
  size?: number;
}

export function StarRating({
  rating,
  onRatingChange,
  readOnly = false,
  className,
  size = 24,
}: StarRatingProps) {
  const [hoverRating, setHoverRating] = React.useState<number | null>(null);

  const displayRating = hoverRating ?? rating ?? 0;

  return (
    <div 
      className={cn("flex items-center gap-1", className)}
      onMouseLeave={() => !readOnly && setHoverRating(null)}
      data-testid="star-rating"
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readOnly}
          onClick={() => !readOnly && onRatingChange?.(star)}
          onMouseEnter={() => !readOnly && setHoverRating(star)}
          className={cn(
            "transition-all duration-200 ease-out p-1 -m-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full",
            readOnly ? "cursor-default" : "cursor-pointer hover:scale-110 active:scale-95"
          )}
          data-testid={`star-${star}`}
          aria-label={`Rate ${star} stars`}
        >
          <Star
            size={size}
            className={cn(
              "transition-colors duration-200",
              star <= displayRating
                ? "fill-primary text-primary"
                : "fill-transparent text-muted-foreground"
            )}
          />
        </button>
      ))}
    </div>
  );
}
