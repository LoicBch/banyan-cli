"use client";

/**
 * Plan review modal for delegated features awaiting approval.
 *
 * Shows the TODO list the agent built (= its proposed plan) plus the
 * approval state metadata (when submitted, optional rejection history).
 * User can Approve → unblock the agent, or Reject + note → agent gets
 * the note via the Stop hook and re-plans.
 *
 * Backend: POST /api/actions/approve  { project, feature, scope: "plan",
 *                                       reject?: boolean, note?: string }
 */
import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, X, Loader2 } from "lucide-react";
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

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

interface TodoData {
  items: TodoItem[];
  updatedAt: string;
}

export function openPlanReviewDialog(project: string, feature: string, onDone?: () => void): void {
  openDialog((close) => (
    <ThemeProvider>
      <PlanReviewBody project={project} feature={feature} onDone={onDone} close={close} />
    </ThemeProvider>
  ));
}

function PlanReviewBody({
  project,
  feature,
  onDone,
  close,
}: {
  project: string;
  feature: string;
  onDone?: () => void;
  close: () => void;
}): React.JSX.Element {
  const [todo, setTodo] = React.useState<TodoData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [rejectMode, setRejectMode] = React.useState(false);
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    fetch(`/api/todos/${encodeURIComponent(project)}/${encodeURIComponent(feature)}`)
      .then((r) => r.json())
      .then((d) => setTodo(d.todo ?? null))
      .catch(() => setTodo(null))
      .finally(() => setLoading(false));
  }, [project, feature]);

  async function dispatchApprove() {
    setSubmitting(true);
    const r = await actions.approve(project, feature, "plan");
    setSubmitting(false);
    if (r.ok) {
      toast.success(`Plan approved — agent unblocked`);
      onDone?.();
      close();
    } else {
      toast.error("Approve failed", { description: r.error });
    }
  }

  async function dispatchReject() {
    if (!note.trim()) {
      toast.error("A rejection note is required");
      return;
    }
    setSubmitting(true);
    const r = await actions.approve(project, feature, "plan", { reject: true, note: note.trim() });
    setSubmitting(false);
    if (r.ok) {
      toast.success(`Plan rejected — agent will revise`);
      onDone?.();
      close();
    } else {
      toast.error("Reject failed", { description: r.error });
    }
  }

  return (
    <DialogShell onClose={close} className="w-[min(95vw,40rem)]">
      <DialogHeader subtitle={`Review the plan the agent proposed for '${feature}'`}>
        Plan review
      </DialogHeader>
      <DialogBody>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading plan…
          </div>
        ) : !todo || todo.items.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            The agent hasn't built a TODO list yet — wait for it to call <code>banyan_set_todo</code>.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              {todo.items.length} {todo.items.length === 1 ? "step" : "steps"} · submitted{" "}
              {new Date(todo.updatedAt).toLocaleString()}
            </div>
            <ol className="space-y-1.5">
              {todo.items.map((it, i) => (
                <li
                  key={it.id}
                  className="flex items-start gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-sm"
                >
                  <span className="text-muted-foreground/60 font-mono text-xs shrink-0 w-5">
                    {i + 1}.
                  </span>
                  <span className="font-mono text-xs leading-relaxed">{it.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {rejectMode ? (
          <div className="space-y-2 pt-2 border-t border-border">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="reject-note">
              Why are you rejecting? <span className="text-emerald-500">*</span>
            </label>
            <Textarea
              id="reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. missing the auth refactor step before login implementation"
              rows={3}
              className="text-xs"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground/70">
              The agent sees this note via the Stop hook and revises its plan accordingly.
            </p>
          </div>
        ) : null}
      </DialogBody>
      <DialogFooter>
        {rejectMode ? (
          <>
            <Button variant="ghost" onClick={() => { setRejectMode(false); setNote(""); }} disabled={submitting}>
              Back
            </Button>
            <Button
              onClick={dispatchReject}
              disabled={submitting || !note.trim()}
              variant="destructive"
              className="gap-1.5"
            >
              <X className="size-4" />
              {submitting ? "Rejecting…" : "Reject plan"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => setRejectMode(true)} disabled={submitting || loading} className="gap-1.5">
              <X className="size-4" /> Reject
            </Button>
            <Button onClick={dispatchApprove} disabled={submitting || loading || !todo || todo.items.length === 0} className="gap-1.5">
              <CheckCircle2 className="size-4" />
              {submitting ? "Approving…" : "Approve plan"}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogShell>
  );
}
