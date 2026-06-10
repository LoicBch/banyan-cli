/**
 * Replacement for window.confirm() — proper themed dialog with optional
 * destructive styling and a bullet list of consequences.
 *
 * Returns a Promise<boolean>: true if confirmed, false on cancel/Escape/
 * backdrop click.
 *
 * Usage:
 *   const ok = await confirm({
 *     title: "Cleanup 'profile-page'?",
 *     description: "This removes worktrees, deletes branches, drops volumes.",
 *     consequences: [
 *       "3 worktrees removed (front, back, app)",
 *       "branch feature/profile-page deleted",
 *       "compose stack dropped + volumes lost",
 *     ],
 *     destructive: true,
 *     confirmLabel: "Delete everything",
 *   });
 *   if (!ok) return;
 */
import * as React from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { openDialog } from "./imperative-dialog";
import { ThemeProvider } from "./theme";
import { Button } from "@/components/ui/button";
import { DialogShell, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/dialog-shell";

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Optional bullet list of what's about to happen — particularly useful
   *  for destructive operations so the user sees the full blast radius. */
  consequences?: readonly string[];
  /** Renders the primary button in red and shows a warning icon in the
   *  header. Default: false. */
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let handled = false;
    const handle = (value: boolean) => {
      if (handled) return;
      handled = true;
      resolve(value);
    };

    openDialog((close) => {
      const onCancel = () => {
        handle(false);
        close();
      };
      const onConfirm = () => {
        handle(true);
        close();
      };
      return (
        <ThemeProvider>
          <ConfirmBody
            opts={opts}
            onCancel={onCancel}
            onConfirm={onConfirm}
            onClose={onCancel}
          />
        </ThemeProvider>
      );
    });
  });
}

function ConfirmBody({
  opts,
  onCancel,
  onConfirm,
  onClose,
}: {
  opts: ConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  // Focus the confirm button on mount so Enter immediately confirms — but
  // for destructive actions, focus Cancel instead so an accidental Enter
  // doesn't nuke anything.
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    const target = opts.destructive ? cancelRef.current : confirmRef.current;
    target?.focus();
  }, [opts.destructive]);

  return (
    <DialogShell onClose={onClose} className="w-[min(92vw,28rem)]">
      <DialogHeader>
        <span className="inline-flex items-center gap-2">
          {opts.destructive ? (
            <AlertTriangle className="size-4 text-destructive" />
          ) : (
            <HelpCircle className="size-4 text-muted-foreground" />
          )}
          {opts.title}
        </span>
      </DialogHeader>
      <DialogBody className="space-y-3">
        {opts.description ? (
          <p className="text-sm text-muted-foreground">{opts.description}</p>
        ) : null}
        {opts.consequences && opts.consequences.length > 0 ? (
          <ul className="rounded-md border border-border bg-background/50 p-3 space-y-1.5 text-xs">
            {opts.consequences.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-muted-foreground/70 mt-0.5">·</span>
                <span className="text-foreground/90">{c}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
          {opts.cancelLabel ?? "Cancel"}
        </Button>
        <Button
          ref={confirmRef}
          variant={opts.destructive ? "destructive" : "default"}
          onClick={onConfirm}
        >
          {opts.confirmLabel ?? "Confirm"}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}
