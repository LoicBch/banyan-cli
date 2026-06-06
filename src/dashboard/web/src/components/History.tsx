/**
 * History view — chronology of merges, rebases, cleanups, and ask Q&A for the
 * active project. Sorted newest first.
 *
 * Backend:
 *   GET /api/history/:project?limit=500&kind=...&feature=...
 *   GET /api/reports/:project?latestOnly=...&feature=...
 *
 * The legacy view also surfaced end-of-task reports inline. We do the same
 * here: merge events from both endpoints, sort by ts.
 */
import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, GitMerge, RotateCcw, Trash2, FileText, History as HistoryIcon } from "lucide-react";

interface HistoryEvent {
  ts: string;
  kind: "merge" | "rebase" | "cleanup" | string;
  feature: string;
  repo?: string;
  base?: string;
  strategy?: string;
  mrNumber?: number;
  mrUrl?: string;
  mrTitle?: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
  local?: boolean;
  durationMs?: number;
  forced?: boolean;
}

interface Report {
  ts: number | string;
  feature: string;
  summary?: string;
  status?: string;
}

interface HistoryProps {
  projectName: string | null;
}

export function History({ projectName }: HistoryProps): React.JSX.Element {
  const [events, setEvents] = React.useState<HistoryEvent[]>([]);
  const [reports, setReports] = React.useState<Report[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<string>("all");

  React.useEffect(() => {
    if (!projectName) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/history/${encodeURIComponent(projectName)}?limit=200`).then((r) => r.json()).catch(() => ({ events: [] })),
      fetch(`/api/reports/${encodeURIComponent(projectName)}`).then((r) => r.json()).catch(() => ({ reports: [] })),
    ])
      .then(([h, r]) => {
        setEvents(h.events ?? []);
        setReports(r.reports ?? []);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [projectName]);

  if (!projectName) return <NoProjectPanel />;
  if (error) return <ErrorPanel msg={error} />;
  if (loading) return <Skeleton />;

  const filtered = filter === "all"
    ? events
    : filter === "reports"
      ? []
      : events.filter((e) => e.kind === filter);
  const merged = mergeAndSort(filter === "all" || filter === "reports" ? filtered : filtered, filter === "all" || filter === "reports" ? reports : []);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6 animate-fade-in">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-foreground">{projectName}</span> · {events.length} events · {reports.length} reports
          </p>
        </div>
        <FilterPills value={filter} onChange={setFilter} />
      </header>

      {merged.length === 0 ? (
        <EmptyPanel />
      ) : (
        <div className="space-y-2">
          {merged.map((item, i) => (
            <Item key={i} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

type Item = ({ type: "event" } & HistoryEvent) | ({ type: "report" } & Report);

function mergeAndSort(events: HistoryEvent[], reports: Report[]): Item[] {
  const all: Item[] = [
    ...events.map((e) => ({ type: "event" as const, ...e })),
    ...reports.map((r) => ({ type: "report" as const, ...r })),
  ];
  return all.sort((a, b) => {
    const ta = typeof a.ts === "number" ? a.ts : Date.parse(a.ts);
    const tb = typeof b.ts === "number" ? b.ts : Date.parse(b.ts);
    return tb - ta;
  });
}

function FilterPills({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  const opts = [
    { id: "all", label: "All" },
    { id: "merge", label: "Merges" },
    { id: "rebase", label: "Rebases" },
    { id: "cleanup", label: "Cleanups" },
    { id: "reports", label: "Reports" },
  ];
  return (
    <div className="flex gap-1 rounded-md border border-border p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={
            o.id === value
              ? "px-2.5 py-1 text-xs rounded bg-accent text-foreground"
              : "px-2.5 py-1 text-xs rounded text-muted-foreground hover:text-foreground transition-colors"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Item({ item }: { item: Item }): React.JSX.Element {
  if (item.type === "report") return <ReportRow report={item} />;
  return <EventRow event={item} />;
}

function EventRow({ event }: { event: HistoryEvent }): React.JSX.Element {
  const icon = event.kind === "merge"
    ? <GitMerge className="size-4" />
    : event.kind === "rebase"
      ? <RotateCcw className="size-4" />
      : event.kind === "cleanup"
        ? <Trash2 className="size-4" />
        : <HistoryIcon className="size-4" />;

  const variant: "info" | "muted" | "destructive" = event.kind === "merge" ? "info" : "muted";

  return (
    <Card className="hover:border-primary/40 transition-colors">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted p-1.5 mt-0.5 text-muted-foreground shrink-0">{icon}</div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={variant}>{event.kind}</Badge>
              <span className="font-mono text-sm truncate">{event.feature}</span>
              {event.repo ? <span className="text-xs text-muted-foreground">· {event.repo}</span> : null}
              {event.base ? <span className="text-xs text-muted-foreground">→ {event.base}</span> : null}
            </div>
            {event.mrTitle ? (
              <div className="text-sm">{event.mrTitle}</div>
            ) : null}
            <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
              <time>{formatTs(event.ts)}</time>
              {event.strategy ? <span>strategy: {event.strategy}</span> : null}
              {typeof event.filesChanged === "number" ? <span>{event.filesChanged} files</span> : null}
              {typeof event.additions === "number" ? <span className="text-emerald-500">+{event.additions}</span> : null}
              {typeof event.deletions === "number" ? <span className="text-rose-500">-{event.deletions}</span> : null}
              {event.forced ? <Badge variant="destructive">forced</Badge> : null}
            </div>
          </div>
          {event.mrUrl ? (
            <Button variant="ghost" size="icon" asChild title="Open MR/PR">
              <a href={event.mrUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ReportRow({ report }: { report: Report }): React.JSX.Element {
  return (
    <Card className="hover:border-primary/40 transition-colors">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted p-1.5 mt-0.5 text-muted-foreground shrink-0">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="success">report</Badge>
              <span className="font-mono text-sm truncate">{report.feature}</span>
              {report.status ? <Badge variant="muted">{report.status}</Badge> : null}
            </div>
            {report.summary ? (
              <p className="text-sm text-muted-foreground line-clamp-3">{report.summary}</p>
            ) : null}
            <time className="text-xs text-muted-foreground">{formatTs(report.ts)}</time>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatTs(ts: string | number): string {
  const date = new Date(typeof ts === "number" ? ts : ts);
  return date.toLocaleString();
}

function NoProjectPanel(): React.JSX.Element {
  return <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">No project selected.</div>;
}

function Skeleton(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-3">
      <div className="h-8 w-24 rounded bg-muted animate-pulse" />
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-muted/50 animate-pulse" />)}
    </div>
  );
}

function EmptyPanel(): React.JSX.Element {
  return (
    <Card className="border-dashed">
      <CardContent className="py-10 text-center space-y-2">
        <h3 className="text-base font-medium">No history yet</h3>
        <p className="text-sm text-muted-foreground">Events appear after the first merge, rebase, cleanup, or report.</p>
      </CardContent>
    </Card>
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
