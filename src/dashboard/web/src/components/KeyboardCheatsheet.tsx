"use client";

/**
 * Keyboard shortcuts cheatsheet — opens via `?`. Static content for now;
 * if we add user-configurable bindings later we'll source the list from
 * the same place the handlers register.
 */
import * as React from "react";
import { openDialog } from "@/lib/imperative-dialog";
import { ThemeProvider } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  DialogShell,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog-shell";

interface Binding {
  keys: string[];
  label: string;
}

interface Group {
  title: string;
  bindings: Binding[];
}

const GROUPS: Group[] = [
  {
    title: "Global",
    bindings: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["?"], label: "Show this cheatsheet" },
      { keys: ["n"], label: "New feature (current project)" },
      { keys: ["Esc"], label: "Close dialog / deselect" },
    ],
  },
  {
    title: "Pipeline navigation",
    bindings: [
      { keys: ["j"], label: "Next feature" },
      { keys: ["k"], label: "Previous feature" },
      { keys: ["↑"], label: "Previous feature" },
      { keys: ["↓"], label: "Next feature" },
    ],
  },
  {
    title: "Pipeline actions (on selected feature)",
    bindings: [
      { keys: ["s"], label: "Start / Stop run processes" },
      { keys: ["m"], label: "Merge feature…" },
      { keys: ["c"], label: "Cleanup feature…" },
      { keys: ["a"], label: "Copy attach command" },
    ],
  },
];

export function openKeyboardCheatsheet(): void {
  openDialog((close) => (
    <ThemeProvider>
      <CheatsheetBody close={close} />
    </ThemeProvider>
  ));
}

function CheatsheetBody({ close }: { close: () => void }): React.JSX.Element {
  return (
    <DialogShell onClose={close} className="w-[min(95vw,32rem)]">
      <DialogHeader subtitle="Press `?` at any time to bring this back.">
        Keyboard shortcuts
      </DialogHeader>
      <DialogBody className="space-y-5">
        {GROUPS.map((g) => (
          <section key={g.title} className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              {g.title}
            </h3>
            <ul className="space-y-1.5">
              {g.bindings.map((b, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-foreground/90">{b.label}</span>
                  <span className="flex items-center gap-1">
                    {b.keys.map((k, j) => (
                      <Kbd key={j}>{k}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>Close</Button>
      </DialogFooter>
    </DialogShell>
  );
}

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="min-w-[1.75rem] h-7 px-1.5 inline-flex items-center justify-center rounded border border-border bg-muted/50 text-[11px] font-mono text-foreground shadow-sm">
      {children}
    </kbd>
  );
}
