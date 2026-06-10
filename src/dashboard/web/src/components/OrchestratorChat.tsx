"use client";

/**
 * Compact chat box at the top of the Pipeline view — talk to the
 * project's orchestrator agent from the dashboard.
 *
 * Two send modes:
 *  - Send  → permissive: orchestrator decides what to do (chat, edit
 *            main, answer a question, …). Same vibe as typing in its
 *            tmux pane directly.
 *  - Delegate → strict coordinator: the prompt is wrapped with a
 *            "[delegation request] …" directive. The orchestrator
 *            decomposes into sub-features and spawns them via
 *            banyan_create_feature, no inline code work this turn.
 *
 * Backend: POST /api/actions/orchestrator-task { project, prompt,
 *                                                delegate?: boolean }.
 */
import * as React from "react";
import { toast } from "sonner";
import { Send, GitBranchPlus, MessageSquare, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import * as actions from "@/lib/actions";
import { cn } from "@/lib/utils";

interface OrchestratorChatProps {
  project: string;
}

const STORAGE_OPEN = "banyan.web.orchestratorChat.open";

export function OrchestratorChat({ project }: OrchestratorChatProps): React.JSX.Element {
  const [open, setOpen] = React.useState<boolean>(() => {
    return localStorage.getItem(STORAGE_OPEN) === "true";
  });
  const [prompt, setPrompt] = React.useState("");
  const [sending, setSending] = React.useState<null | "send" | "delegate">(null);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_OPEN, String(open));
  }, [open]);

  async function dispatch(mode: "send" | "delegate"): Promise<void> {
    if (!prompt.trim()) {
      toast.error("Message can't be empty");
      return;
    }
    setSending(mode);
    const r = await actions.sendOrchestratorTask(project, prompt.trim(), {
      delegate: mode === "delegate",
    });
    setSending(null);
    if (r.ok) {
      toast.success(
        mode === "delegate"
          ? `Delegation request sent — orchestrator will decompose`
          : `Sent to orchestrator`,
      );
      setPrompt("");
    } else {
      toast.error("Send failed", { description: r.error });
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 rounded-lg border border-dashed border-border/60 bg-card/30 px-3 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:bg-accent/40 transition-colors"
      >
        <ChevronRight className="size-3.5" />
        <MessageSquare className="size-3.5" />
        <span>Talk to orchestrator</span>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3 space-y-2">
      <button
        onClick={() => setOpen(false)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className="size-3.5" />
        <MessageSquare className="size-3.5" />
        <span>Talk to orchestrator</span>
      </button>
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. implement OAuth login on the front, add /auth/* endpoints on the back, migrate user table on the db repo"
        rows={3}
        className="text-sm"
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter → Send. ⌘/Ctrl+Shift+Enter → Delegate.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void dispatch(e.shiftKey ? "delegate" : "send");
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground/70">
          ⌘+Enter to send · ⌘+Shift+Enter to delegate
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch("send")}
            disabled={sending !== null || !prompt.trim()}
            className="gap-1.5"
            title="Send as a normal message — orchestrator decides what to do"
          >
            <Send className="size-3.5" />
            {sending === "send" ? "Sending…" : "Send"}
          </Button>
          <Button
            size="sm"
            onClick={() => dispatch("delegate")}
            disabled={sending !== null || !prompt.trim()}
            className={cn(
              "gap-1.5 bg-emerald-500/15 border border-emerald-500/50 text-emerald-500",
              "hover:bg-emerald-500/25 hover:border-emerald-500/70",
            )}
            title="Force the orchestrator to decompose into sub-features and spawn them"
          >
            <GitBranchPlus className="size-3.5" />
            {sending === "delegate" ? "Delegating…" : "Delegate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
