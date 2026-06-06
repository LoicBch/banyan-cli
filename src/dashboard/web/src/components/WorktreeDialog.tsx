/**
 * "+ New feature" dialog — wraps POST /api/wt.
 *
 * Three inputs: optional feature name (LLM-infers from prompt if blank),
 * first prompt for the agent, and agent mode. Mirrors what the legacy
 * `openNewWorktreeModal` does, but with shadcn + sonner toasts.
 */
import * as React from "react";
import { toast } from "sonner";
import { openDialog } from "@/lib/imperative-dialog";
import { ThemeProvider } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogShell, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/dialog-shell";
import * as actions from "@/lib/actions";

const MODES = ["interactive", "assisted", "autonomous", "autopilot"] as const;
type Mode = (typeof MODES)[number];

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
  const [mode, setMode] = React.useState<Mode>("autonomous");
  const [busy, setBusy] = React.useState(false);
  const promptRef = React.useRef<HTMLTextAreaElement>(null);

  // Focus the prompt field on mount — it's the most-used input.
  React.useEffect(() => {
    promptRef.current?.focus();
  }, []);

  async function submit() {
    setBusy(true);
    const r = await actions.createWorktree({
      project,
      ...(feature.trim() ? { feature: feature.trim() } : {}),
      ...(prompt.trim() ? { initialPrompt: prompt.trim() } : {}),
      mode,
    });
    setBusy(false);
    if (r.ok) {
      toast.success(r.draft ? `Draft created — agent will finalize the name` : `Created ${r.feature ?? ""}`);
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
          <div className="flex gap-1.5 flex-wrap">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={
                  m === mode
                    ? "px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground transition-colors"
                    : "px-2.5 py-1 text-xs rounded-md bg-secondary text-secondary-foreground hover:bg-accent transition-colors"
                }
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
      </DialogFooter>
    </DialogShell>
  );
}
