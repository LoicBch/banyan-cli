/**
 * Ask view — chat-style Q&A backed by /api/ask/:project SSE.
 *
 * Sends: { question, feature?, days?, includeTranscripts? }
 * SSE events:
 *   - chunk: { text }       — append to live answer
 *   - done:  { record }     — final, push to history
 *   - error: { message }    — abort with toast
 *
 * History from GET /api/ask/:project/history?limit=50.
 *
 * Implementation note: EventSource doesn't support POST bodies, so we use
 * fetch + ReadableStream + manual SSE parsing — same trick the legacy
 * dashboard uses.
 */
import * as React from "react";
import { toast } from "sonner";
import { Send, Loader2, ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

interface AskRecord {
  ts: string;
  question: string;
  answer: string;
  durationMs?: number;
  scope?: { feature?: string };
}

interface AskProps {
  projectName: string | null;
}

export function Ask({ projectName }: AskProps): React.JSX.Element {
  const [question, setQuestion] = React.useState("");
  const [feature, setFeature] = React.useState("");
  const [streaming, setStreaming] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<AskRecord[]>([]);
  const [includeTranscripts, setIncludeTranscripts] = React.useState(true);
  const abortRef = React.useRef<AbortController | null>(null);
  const answerRef = React.useRef<HTMLDivElement>(null);

  // Pull recent history on project change.
  React.useEffect(() => {
    if (!projectName) return;
    fetch(`/api/ask/${encodeURIComponent(projectName)}/history?limit=20`)
      .then((r) => r.json())
      .then((d) => setHistory(d.records ?? []))
      .catch(() => undefined);
  }, [projectName]);

  // Auto-scroll while streaming.
  React.useEffect(() => {
    if (streaming !== null && answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [streaming]);

  async function submit() {
    if (!projectName) return;
    if (!question.trim()) { toast.error("Type a question first"); return; }

    setStreaming("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const r = await fetch(`/api/ask/${encodeURIComponent(projectName)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          ...(feature ? { feature } : {}),
          includeTranscripts,
        }),
        signal: ctrl.signal,
      });

      if (!r.ok || !r.body) {
        const errText = await r.text().catch(() => `${r.status}`);
        throw new Error(errText);
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // SSE frame parser — events are separated by blank lines, each frame
      // has `event: <name>` and `data: <json>` lines.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const lines = frame.split("\n");
          let eventName = "message";
          let dataLine = "";
          for (const l of lines) {
            if (l.startsWith("event: ")) eventName = l.slice(7).trim();
            else if (l.startsWith("data: ")) dataLine += l.slice(6);
          }
          if (!dataLine) continue;
          let payload: unknown;
          try { payload = JSON.parse(dataLine); } catch { continue; }
          if (eventName === "chunk") {
            const text = (payload as { text: string }).text ?? "";
            setStreaming((s) => (s ?? "") + text);
          } else if (eventName === "done") {
            const record = (payload as { record: AskRecord }).record;
            setHistory((h) => [record, ...h]);
            setStreaming(null);
            setQuestion("");
          } else if (eventName === "error") {
            const msg = (payload as { message: string }).message ?? "unknown error";
            toast.error("Ask failed", { description: msg });
            setStreaming(null);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error("Ask failed", { description: (err as Error).message });
      }
      setStreaming(null);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setStreaming(null);
  }

  if (!projectName) {
    return <div className="mx-auto max-w-3xl p-6 text-sm text-muted-foreground">No project selected.</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6 animate-fade-in">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Ask</h1>
        <p className="text-sm text-muted-foreground">
          Answer questions about <span className="font-mono text-foreground">{projectName}</span> from past reports, commits, and agent transcripts.
        </p>
      </header>

      <Card>
        <CardContent className="p-3 space-y-2">
          <Textarea
            placeholder="What changed on auth this month? — Cmd+Enter to send"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
            className="resize-none border-0 shadow-none focus-visible:ring-0 px-2"
          />
          <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-border">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <input
                placeholder="filter by feature (optional)"
                value={feature}
                onChange={(e) => setFeature(e.target.value.trim())}
                className="h-7 px-2 rounded-md border border-input bg-background text-xs font-mono w-44"
              />
              <label className="inline-flex items-center gap-1 text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeTranscripts}
                  onChange={(e) => setIncludeTranscripts(e.target.checked)}
                  className="accent-primary"
                />
                include transcripts
              </label>
            </div>
            {streaming !== null ? (
              <Button variant="ghost" size="sm" onClick={cancel}>Cancel</Button>
            ) : (
              <Button size="sm" onClick={submit} className="gap-1.5" disabled={!question.trim()}>
                <Send className="size-4" /> Send
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {streaming !== null ? (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> streaming…
            </div>
            <div
              ref={answerRef}
              className="text-sm whitespace-pre-wrap max-h-96 overflow-y-auto font-sans"
            >
              {streaming || <span className="text-muted-foreground italic">waiting for first chunk…</span>}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {history.length === 0 && streaming === null ? (
        <EmptyState
          icon={MessageSquare}
          title="Ask something about this project"
          description="banyan reads past end-of-task reports, recent git history, and agent transcripts to answer. Filter by feature when you want a focused answer."
          hint={
            <>
              Try:{" "}
              <span className="text-foreground italic">"what changed on auth this month?"</span>{" "}
              · <span className="text-foreground italic">"what's still pending on the login feature?"</span>
            </>
          }
        />
      ) : null}

      {history.map((r, i) => <Record key={i} record={r} />)}
    </div>
  );
}

function Record({ record }: { record: AskRecord }): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <Card>
      <CardContent className="p-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-start gap-2 text-left"
        >
          {open ? <ChevronDown className="size-4 mt-0.5 text-muted-foreground shrink-0" /> : <ChevronRight className="size-4 mt-0.5 text-muted-foreground shrink-0" />}
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-sm font-medium truncate">{record.question}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <time>{new Date(record.ts).toLocaleString()}</time>
              {record.scope?.feature ? <Badge variant="muted">{record.scope.feature}</Badge> : null}
              {record.durationMs ? <span>{Math.round(record.durationMs / 100) / 10}s</span> : null}
            </div>
          </div>
        </button>
        {open ? (
          <div className={cn("mt-3 pt-3 border-t border-border text-sm whitespace-pre-wrap text-foreground/90")}>
            {record.answer}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
