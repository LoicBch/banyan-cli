/**
 * "+ New feature" dialog — wraps POST /api/wt.
 *
 * Three inputs: optional feature name (LLM-infers from prompt if blank),
 * first prompt for the agent, and agent mode. Mirrors what the legacy
 * `openNewWorktreeModal` does, but with shadcn + sonner toasts.
 */
import * as React from "react";
import { toast } from "sonner";
import { Terminal } from "lucide-react";
import { openDialog } from "@/lib/imperative-dialog";
import { ThemeProvider } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogShell, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/dialog-shell";
import * as actions from "@/lib/actions";
import { fetchState } from "@/lib/api";

const STORAGE_OPEN_TERMINAL = "banyan.web.openTerminalAfterSpawn";

const MODES = [
  {
    id: "live" as const,
    label: "Live",
    description: "banyan-aware claude, conversational. you drive at the terminal.",
  },
  {
    id: "delegated" as const,
    label: "Delegated",
    description: "pipeline-gated: plan-review → execute → report. fire-and-forget.",
  },
];
type Mode = (typeof MODES)[number]["id"];

export function openWorktreeDialog(project: string): void {
  openDialog((close) => (
    <ThemeProvider>
      <WorktreeDialogBody project={project} close={close} />
    </ThemeProvider>
  ));
}

function WorktreeDialogBody({ project, close }: { project: string; close: () => void }): React.JSX.Element {
  const [feature, setFeature] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("delegated");
  const [busy, setBusy] = React.useState(false);
  const [localMode, setLocalMode] = React.useState<boolean | null>(null);
  // Default to true so the most common flow (local dev, want to see the agent)
  // works out of the box. Persisted across sessions in localStorage.
  const [openTerminal, setOpenTerminal] = React.useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_OPEN_TERMINAL);
    return stored === null ? true : stored === "true";
  });
  const promptRef = React.useRef<HTMLTextAreaElement>(null);

  // Focus the prompt field on mount — it's the most-used input.
  React.useEffect(() => {
    promptRef.current?.focus();
  }, []);

  // Detect whether the backend can spawn a terminal (= local mode). When
  // we're behind the `--remote` tunnel, the terminal checkbox is hidden:
  // it would silently no-op anyway, no point teasing it.
  React.useEffect(() => {
    fetchState()
      .then((s) => setLocalMode(s.localMode ?? false))
      .catch(() => setLocalMode(false));
  }, []);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_OPEN_TERMINAL, String(openTerminal));
  }, [openTerminal]);

  async function submit() {
    setBusy(true);
    const r = await actions.createWorktree({
      project,
      ...(feature.trim() ? { feature: feature.trim() } : {}),
      ...(prompt.trim() ? { initialPrompt: prompt.trim() } : {}),
      mode,
      openTerminal: openTerminal && localMode === true,
    });
    setBusy(false);
    if (r.ok) {
      const base = r.draft ? `Draft created — agent will finalize the name` : `Created ${r.feature ?? ""}`;
      const suffix = r.terminalAttachedToExisting
        ? " — switch to your terminal to see the agent"
        : r.terminalOpened
          ? " — terminal opened"
          : "";
      toast.success(base + suffix);
      if (r.terminalError) {
        toast.warning("Terminal couldn't open", { description: r.terminalError });
      }
      close();
    } else {
      toast.error("Create failed", { description: r.error ?? "unknown error" });
    }
  }

  return (
    <DialogShell onClose={close} className="w-[min(95vw,32rem)]">
      <DialogHeader subtitle={`Create a worktree in '${project}'`}>New feature</DialogHeader>
      <DialogBody>
        <div className="space-y-1.5">
          <Label htmlFor="wt-feature">Feature name (optional)</Label>
          <Input
            id="wt-feature"
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
            placeholder="leave empty for draft — agent will name it"
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wt-prompt">First prompt to the agent</Label>
          <Textarea
            id="wt-prompt"
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="describe the task — the agent picks a slug from this"
            rows={4}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Mode</Label>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => {
              const selected = m.id === mode;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={
                    selected
                      ? "rounded-lg border border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/40 px-3 py-2 text-left transition-all duration-200 ease-out active:scale-95"
                      : "rounded-lg border border-border bg-card/40 px-3 py-2 text-left hover:border-primary/40 hover:bg-accent/40 transition-all duration-200 ease-out active:scale-95"
                  }
                >
                  <div className={selected ? "text-sm font-semibold text-foreground" : "text-sm font-medium text-muted-foreground"}>
                    {m.label}
                  </div>
                  <div className="text-[11px] leading-snug text-muted-foreground/80 mt-0.5">
                    {m.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Local-mode only: native terminal launch after spawn. In remote
         *  (--tunnel) mode we hide the checkbox entirely since the backend
         *  can't usefully spawn a window on the phone. */}
        {localMode === true ? (
          <label className="flex items-start gap-2 pt-1 cursor-pointer group">
            <input
              type="checkbox"
              checked={openTerminal}
              onChange={(e) => setOpenTerminal(e.target.checked)}
              className="mt-0.5 size-3.5 accent-emerald-500"
            />
            <span className="text-xs leading-snug">
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <Terminal className="size-3.5" />
                Open in terminal after spawning
              </span>
              <span className="block text-muted-foreground/70">
                Pops a native window already attached to the tmux session so
                you see the agent live. Uncheck to stay in dashboard-only
                pipeline mode.
              </span>
            </span>
          </label>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
      </DialogFooter>
    </DialogShell>
  );
}
