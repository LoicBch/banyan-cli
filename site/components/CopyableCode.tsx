"use client";

/**
 * One-line copy-to-clipboard code pill. The whole pill is clickable; the
 * copy icon flips to a check for 1.5s on success, matching the affordance
 * users expect from Vercel-style sites.
 */
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyableCode({ children, className }: { children: string; className?: string }): React.JSX.Element {
  const [copied, setCopied] = React.useState(false);

  function copy() {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      onClick={copy}
      className={cn(
        "group inline-flex max-w-full items-center gap-3 rounded-lg border border-border bg-card/70 backdrop-blur",
        "px-4 py-2.5 font-mono text-xs sm:text-sm text-muted-foreground",
        "hover:border-primary/30 hover:bg-card transition-colors",
        className,
      )}
      aria-label="Copy command"
    >
      <span className="text-primary shrink-0">$</span>
      <span className="truncate text-foreground">{children}</span>
      {copied ? (
        <Check className="size-4 text-primary shrink-0" />
      ) : (
        <Copy className="size-4 shrink-0 group-hover:text-foreground transition-colors" />
      )}
    </button>
  );
}
