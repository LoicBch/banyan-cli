/**
 * Shared dialog chrome (overlay + card + close on backdrop click + Esc).
 *
 * We don't pull @radix-ui/react-dialog yet because every dialog so far is
 * imperatively opened — Radix's controlled-open API is overkill. This is
 * accessible-enough for v1 (focus-trap can be added when needed).
 */
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DialogShellProps {
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}

export function DialogShell({ onClose, className, children }: DialogShellProps): React.JSX.Element {
  // Close on Escape.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "relative bg-card border border-border rounded-lg shadow-2xl",
          "w-[min(95vw,42rem)] max-h-[90vh] flex flex-col",
          className,
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 size-7 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ children, subtitle }: { children: React.ReactNode; subtitle?: string }): React.JSX.Element {
  return (
    <div className="px-5 py-4 border-b border-border">
      <div className="text-base font-semibold tracking-tight">{children}</div>
      {subtitle ? <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div> : null}
    </div>
  );
}

export function DialogBody({ children, className }: { children: React.ReactNode; className?: string }): React.JSX.Element {
  return <div className={cn("flex-1 overflow-y-auto p-5 space-y-4", className)}>{children}</div>;
}

export function DialogFooter({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
      {children}
    </div>
  );
}
