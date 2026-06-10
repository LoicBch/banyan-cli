"use client";

/**
 * Live chat view of a feature's claude conversation. Pairs the
 * read-only transcript stream (SSE) with the existing "Send message"
 * action so the user can read what the agent has said and respond
 * inline — from the laptop or the phone via `bn serve --remote`.
 *
 *   GET  /api/conversation/:project/:feature        → initial messages
 *   GET  /api/conversation/:project/:feature/stream → SSE for appends
 *   POST /api/actions/task                          → send a message back
 *
 * SSE caveat: when the dashboard is in --remote mode the tunnel may
 * close idle connections. The endpoint sends a heartbeat every 25s
 * and the client auto-reconnects on stream end (best-effort).
 */
import * as React from "react";
import { toast } from "sonner";
import { Send, User, Bot, Loader2 } from "lucide-react";
import { openDialog } from "@/lib/imperative-dialog";
import { ThemeProvider } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DialogShell,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog-shell";
import * as actions from "@/lib/actions";
import { apiFetch } from "@/lib/auth";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  ts: string;
  role: "user" | "assistant";
  text: string;
}

export function openConversationDialog(project: string, feature: string): void {
  openDialog((close) => (
    <ThemeProvider>
      <ConversationBody project={project} feature={feature} close={close} />
    </ThemeProvider>
  ));
}

function ConversationBody({
  project,
  feature,
  close,
}: {
  project: string;
  feature: string;
  close: () => void;
}): React.JSX.Element {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [hasTranscript, setHasTranscript] = React.useState(true);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastIdRef = React.useRef<string>("");

  // Initial fetch + SSE subscription. Reconnect once if the stream ends
  // unexpectedly (idle tunnel timeouts mostly).
  React.useEffect(() => {
    let cancelled = false;
    let reconnectTimer: number | undefined;

    async function load() {
      try {
        const r = await apiFetch(
          `/api/conversation/${encodeURIComponent(project)}/${encodeURIComponent(feature)}?limit=200`,
        );
        if (!r.ok) throw new Error(`${r.status}`);
        const data = (await r.json()) as { messages: ChatMessage[]; transcriptFile: string | null };
        if (cancelled) return;
        setMessages(data.messages);
        setHasTranscript(!!data.transcriptFile);
        if (data.messages.length > 0) {
          lastIdRef.current = data.messages[data.messages.length - 1]!.id;
        }
      } catch {
        if (!cancelled) setHasTranscript(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // EventSource doesn't support Authorization headers — when the
    // dashboard is in --remote mode the SSE stream needs the token via
    // the URL. We pass it as `?token=` (the auth middleware accepts it).
    function openStream(): EventSource | null {
      try {
        let url = `/api/conversation/${encodeURIComponent(project)}/${encodeURIComponent(feature)}/stream`;
        const token = (() => { try { return localStorage.getItem("banyan.dashboard.token"); } catch { return null; } })();
        if (token) url += `?token=${encodeURIComponent(token)}`;
        const es = new EventSource(url);
        es.addEventListener("messages", (e: MessageEvent) => {
          try {
            const newMessages = JSON.parse(e.data) as ChatMessage[];
            if (newMessages.length === 0) return;
            setMessages((cur) => {
              // Dedupe against current last id (SSE can echo if the
              // server restarted while we were connected).
              const next = [...cur];
              for (const m of newMessages) {
                if (m.id > lastIdRef.current) {
                  next.push(m);
                  lastIdRef.current = m.id;
                }
              }
              return next;
            });
          } catch {
            /* swallow malformed event */
          }
        });
        es.addEventListener("error", () => {
          // Auto-reconnect once after 3s; if the second attempt also fails
          // we fall back to manual reload via the dialog close+reopen.
          es.close();
          if (!cancelled && !reconnectTimer) {
            reconnectTimer = window.setTimeout(() => {
              reconnectTimer = undefined;
              openStream();
            }, 3_000);
          }
        });
        return es;
      } catch {
        return null;
      }
    }

    void load().then(() => {
      if (!cancelled) openStream();
    });

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
    };
  }, [project, feature]);

  // Scroll to bottom on new messages.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    if (!draft.trim()) return;
    const text = draft.trim();
    setSending(true);
    // Optimistic insert so the message appears immediately.
    setMessages((cur) => [
      ...cur,
      {
        id: `optimistic-${Date.now()}`,
        ts: new Date().toISOString(),
        role: "user",
        text,
      },
    ]);
    setDraft("");
    const r = await actions.sendTask(project, feature, text);
    setSending(false);
    if (!r.ok) {
      toast.error("Send failed", { description: r.error });
    }
  }

  return (
    <DialogShell onClose={close} className="w-[min(95vw,42rem)] h-[min(85vh,40rem)] flex flex-col">
      <DialogHeader subtitle={`Live conversation with the ${feature} agent`}>
        💬 {feature}
      </DialogHeader>
      <DialogBody className="flex-1 flex flex-col min-h-0">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-3 pr-1 -mr-1"
        >
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading conversation…
            </div>
          ) : !hasTranscript ? (
            <div className="text-center py-12 text-sm text-muted-foreground italic">
              No conversation yet — the agent hasn't produced a transcript.
              <br />
              Send a first message below to get started.
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground italic">
              Transcript is empty so far.
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} msg={m} />)
          )}
        </div>
      </DialogBody>
      <DialogFooter className="flex-col gap-2 items-stretch">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Send a message to the agent…"
          rows={2}
          className="text-sm resize-none"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground/70">
            ⌘+Enter to send. Read-only stream + Send via tmux paste.
          </p>
          <Button onClick={send} disabled={sending || !draft.trim()} size="sm" className="gap-1.5">
            <Send className="size-3.5" />
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </DialogFooter>
    </DialogShell>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }): React.JSX.Element {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "size-7 shrink-0 rounded-full flex items-center justify-center text-xs",
          isUser ? "bg-primary/15 text-primary" : "bg-emerald-500/15 text-emerald-500",
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words",
          isUser
            ? "bg-primary/10 text-foreground"
            : "bg-card border border-border text-foreground",
        )}
      >
        {msg.text}
      </div>
    </div>
  );
}
