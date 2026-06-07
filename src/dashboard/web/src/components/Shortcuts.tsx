/**
 * Shortcuts view — discoverable list of tmux key bindings.
 *
 * Read-mostly. Each action has a default + (sometimes) a user override.
 * Clicking a key chip enters "capture" mode where the next key press becomes
 * the new binding. Save writes the whole `bindings` map back via POST.
 *
 * Format expected from /api/shortcuts:
 *   { actions: [...], bindings: {...}, defaults: {...}, configPath, tmuxConfPath }
 */
import * as React from "react";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface Action {
  id: string;
  label: string;
  description?: string;
}

interface ShortcutsState {
  actions: Action[];
  bindings: Record<string, string>;
  defaults: Record<string, string>;
  configPath?: string;
  tmuxConfPath?: string;
}

export function Shortcuts(): React.JSX.Element {
  const [state, setState] = React.useState<ShortcutsState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [bindings, setBindings] = React.useState<Record<string, string>>({});
  const [capturing, setCapturing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/shortcuts")
      .then((r) => r.json())
      .then((d: ShortcutsState) => {
        setState(d);
        setBindings(d.bindings ?? {});
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Capture key mode: next keypress becomes the chord for `capturing`.
  // Format we emit matches tmux: `M-l`, `C-x`, `S-Enter`, etc.
  React.useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("C-");
      if (e.altKey || e.metaKey) parts.push("M-");
      if (e.shiftKey && e.key.length === 1) parts.push("S-");
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const chord = parts.join("") + key;
      setBindings((b) => ({ ...b, [capturing]: chord }));
      setCapturing(null);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [capturing]);

  async function save() {
    setBusy(true);
    const r = await fetch("/api/shortcuts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bindings }),
    });
    setBusy(false);
    if (r.ok) toast.success("Shortcuts saved");
    else toast.error("Save failed", { description: `${r.status}` });
  }

  function resetDefaults() {
    if (!state) return;
    setBindings({ ...state.defaults });
    toast.info("Reset to defaults — click Save to persist");
  }

  if (error) return <ErrorPanel msg={error} />;
  if (!state) return <ShortcutsSkeleton />;

  const dirty = JSON.stringify(bindings) !== JSON.stringify(state.bindings);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6 animate-fade-in">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shortcuts</h1>
          <p className="text-sm text-muted-foreground">
            Tmux key bindings (installed during <code className="text-foreground">bn init</code>)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={resetDefaults} className="gap-1.5">
            <RotateCcw className="size-4" /> Defaults
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !dirty} className="gap-1.5">
            <Save className="size-4" /> Save
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {state.actions.map((a) => {
            const chord = bindings[a.id] ?? "";
            const isDefault = chord === (state.defaults[a.id] ?? "");
            return (
              <div key={a.id} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{a.label}</div>
                  {a.description ? (
                    <div className="text-xs text-muted-foreground">{a.description}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!isDefault ? <Badge variant="muted">custom</Badge> : null}
                  <Button
                    variant={capturing === a.id ? "default" : "outline"}
                    size="sm"
                    className="font-mono min-w-[5rem]"
                    onClick={() => setCapturing(capturing === a.id ? null : a.id)}
                  >
                    {capturing === a.id ? "press a key…" : chord || "—"}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {state.configPath ? (
        <p className="text-xs text-muted-foreground">
          Stored in <code className="text-foreground">{state.configPath}</code>
          {state.tmuxConfPath ? <> · Sourced from <code className="text-foreground">{state.tmuxConfPath}</code></> : null}
        </p>
      ) : null}
    </div>
  );
}

function ShortcutsSkeleton(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3.5 w-64" />
        </div>
        <Skeleton className="h-8 w-32" />
      </header>
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorPanel({ msg }: { msg: string }): React.JSX.Element {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="p-4 text-sm text-destructive-foreground">
          <strong>Error</strong>: {msg}
        </CardContent>
      </Card>
    </div>
  );
}
