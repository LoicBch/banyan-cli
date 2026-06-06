/**
 * Skeleton loader — animated placeholder.
 *
 * Default style mimics the muted background with a left-to-right shimmer
 * pulse via the `skeleton-shimmer` keyframes defined in tailwind.config.ts.
 *
 * Compose multiple <Skeleton> with shape-matching widths/heights to fake
 * the loading state of a real card or list row.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-muted/60",
        "before:absolute before:inset-0 before:-translate-x-full",
        "before:bg-gradient-to-r before:from-transparent before:via-foreground/[0.04] before:to-transparent",
        "before:animate-[shimmer_1.6s_infinite]",
        className,
      )}
      {...props}
    />
  );
}
