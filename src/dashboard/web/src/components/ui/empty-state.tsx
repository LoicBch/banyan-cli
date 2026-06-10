/**
 * Shared empty-state card — keeps the look consistent across views.
 *
 * Pattern: icon (in a tinted circle) + title + body + optional primary CTA
 * + optional secondary hint (often a code snippet or a link). Each view
 * customises the copy + actions; the chrome stays identical.
 */
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  /** "Accent" tints the icon background with the primary color; useful for
   *  the call-to-action variant. "Muted" is the default (neutral gray). */
  iconTone?: "muted" | "accent";
  title: string;
  description?: React.ReactNode;
  /** Primary action (usually a Button). Rendered below the description. */
  action?: React.ReactNode;
  /** Secondary hint — typically code snippet or text. Smaller, muted,
   *  rendered below the action. */
  hint?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  iconTone = "muted",
  title,
  description,
  action,
  hint,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <Card className={cn("border-dashed", className)}>
      <CardContent className="py-12 text-center space-y-4 animate-fade-in">
        <div
          className={cn(
            "mx-auto w-fit rounded-full p-3",
            iconTone === "accent" ? "bg-primary/10" : "bg-muted",
          )}
        >
          <Icon
            className={cn(
              "size-6",
              iconTone === "accent" ? "text-primary" : "text-muted-foreground",
            )}
          />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-medium tracking-tight">{title}</h3>
          {description ? (
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
        {hint ? (
          <div className="pt-2 text-xs text-muted-foreground/80">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
