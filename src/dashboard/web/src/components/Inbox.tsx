/**
 * Inbox view — tasks pulled from integrations (ClickUp/Linear/Jira).
 *
 * Three actions per task: Spawn (creates a worktree with the task as the
 * agent's first prompt), Dismiss (archive), Poll now (force refresh sources).
 *
 * Backend:
 *   GET /api/integrations/inbox?includeArchived=0|1
 *   POST /api/integrations/poll
 *   POST /api/integrations/spawn  { taskId, project, mode }
 *   POST /api/integrations/dismiss { taskId, note? }
 */
import * as React from "react";
import { toast } from "sonner";
import { RefreshCw, Sparkles, X, ExternalLink, Archive } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface InboxTask {
  id: string;
  title: string;
  description?: string;
  status?: string;
  url?: string;
  source: string;
  assignees?: string[];
}

interface InboxEntry {
  task: InboxTask;
  suggestedProject?: string;
  suggestedMode?: string;
  spawnedAt?: string | null;
  spawnedProject?: string | null;
  spawnedFeature?: string | null;
  dismissedAt?: string | null;
}

interface InboxResponse {
  configured: number;
  entries: InboxEntry[];
}

const MODES = ["interactive", "assisted", "autonomous", "autopilot"];

export function Inbox(): React.JSX.Element {
  const [data, setData] = React.useState<InboxResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [polling, setPolling] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/integrations/inbox?includeArchived=${includeArchived ? 1 : 0}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `${r.status}`);
      setData(d);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [includeArchived]);

  React.useEffect(() => {
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  async function pollNow() {
    setPolling(true);
    const r = await fetch("/api/integrations/poll", { method: "POST" });
    const data = await r.json().catch(() => ({}));
    setPolling(false);
    if (r.ok) {
      toast.success("Poll complete", {
        description: `${data.added ?? 0} added · ${data.refreshed ?? 0} refreshed`,
      });
      load();
    } else {
      toast.error("Poll failed", { description: data.error ?? `${r.status}` });
    }
  }

  if (error) return <ErrorPanel msg={error} />;
  if (!data) return <Skeleton />;

  const active = data.entries.filter((e) => !e.dismissedAt && !e.spawnedAt);
  const archived = data.entries.filter((e) => e.dismissedAt || e.spawnedAt);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6 animate-fade-in">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            {data.configured} source{data.configured === 1 ? "" : "s"} configured · {active.length} active task{active.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIncludeArchived((v) => !v)}
            className="gap-1.5"
          >
            <Archive className="size-4" />
            {includeArchived ? "Hide archived" : "Show archived"}
          </Button>
          <Button size="sm" onClick={pollNow} disabled={polling} className="gap-1.5">
            <RefreshCw className={polling ? "size-4 animate-spin" : "size-4"} />
            Poll now
          </Button>
        </div>
      </header>

      {data.configured === 0 ? (
        <EmptySources />
      ) : active.length === 0 && archived.length === 0 ? (
        <EmptyInbox />
      ) : (
        <div className="space-y-2">
          {active.map((e) => (
            <TaskCard key={e.task.id} entry={e} onChange={load} />
          ))}
          {includeArchived && archived.length > 0 ? (
            <>
              <div className="text-xs text-muted-foreground pt-3">Archived</div>
              {archived.map((e) => (
                <TaskCard key={e.task.id} entry={e} onChange={load} archived />
              ))}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  entry,
  onChange,
  archived = false,
}: {
  entry: InboxEntry;
  onChange: () => void;
  archived?: boolean;
}): React.JSX.Element {
  const [mode, setMode] = React.useState<string>(entry.suggestedMode ?? "autonomous");
  const [project, setProject] = React.useState<string>(entry.suggestedProject ?? "");
  const [busy, setBusy] = React.useState(false);
  const [projects, setProjects] = React.useState<string[]>([]);

  React.useEffect(() => {
    fetch("/api/state").then((r) => r.json()).then((d) => {
      setProjects((d.projects ?? []).map((p: { name: string }) => p.name));
      if (!project && d.projects?.[0]) setProject(d.projects[0].name);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function spawn() {
    if (!project) { toast.error("Pick a project"); return; }
    setBusy(true);
    const r = await fetch("/api/integrations/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: entry.task.id, project, mode }),
    });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok && data.ok) {
      toast.success(`Spawned (${data.feature ?? "draft"})`, {
        description: "agent will finalize the feature name from the task description",
      });
      onChange();
    } else {
      toast.error("Spawn failed", { description: data.error ?? `${r.status}` });
    }
  }

  async function dismiss() {
    setBusy(true);
    const r = await fetch("/api/integrations/dismiss", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskId: entry.task.id }),
    });
    setBusy(false);
    if (r.ok) {
      toast.info("Dismissed");
      onChange();
    } else {
      toast.error("Dismiss failed");
    }
  }

  return (
    <Card className={archived ? "opacity-60" : "hover:border-primary/40 hover:shadow-md transition-all"}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="info">{entry.task.source}</Badge>
              {entry.task.status ? <Badge variant="muted">{entry.task.status}</Badge> : null}
              {entry.spawnedFeature ? <Badge variant="success">spawned: {entry.spawnedFeature}</Badge> : null}
              {entry.dismissedAt ? <Badge variant="muted">dismissed</Badge> : null}
            </div>
            <h3 className="text-sm font-medium">{entry.task.title}</h3>
            {entry.task.description ? (
              <p className="text-xs text-muted-foreground line-clamp-3">{entry.task.description}</p>
            ) : null}
          </div>
          {entry.task.url ? (
            <Button variant="ghost" size="icon" asChild title="Open in source">
              <a href={entry.task.url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : null}
        </div>

        {!archived ? (
          <div className="flex items-end justify-between gap-3 pt-2 border-t border-border">
            <div className="flex gap-2 items-end flex-wrap">
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Project</div>
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm font-mono"
                >
                  {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Mode</div>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={dismiss} disabled={busy} className="gap-1.5">
                <X className="size-4" /> Dismiss
              </Button>
              <Button size="sm" onClick={spawn} disabled={busy} className="gap-1.5">
                <Sparkles className="size-4" /> Spawn
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmptySources(): React.JSX.Element {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 text-center space-y-2">
        <h3 className="text-base font-medium">No integration sources configured</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Add a source to <code className="text-foreground">~/.config/banyan/integrations.yaml</code> to start pulling tasks (ClickUp, etc.)
        </p>
      </CardContent>
    </Card>
  );
}

function EmptyInbox(): React.JSX.Element {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 text-center space-y-2">
        <h3 className="text-base font-medium">Inbox empty</h3>
        <p className="text-sm text-muted-foreground">
          No matching tasks in any source. Click "Poll now" to refresh.
        </p>
      </CardContent>
    </Card>
  );
}

function Skeleton(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-3">
      <div className="h-8 w-24 rounded bg-muted animate-pulse" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 rounded-lg bg-muted/50 animate-pulse" />
        ))}
      </div>
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
