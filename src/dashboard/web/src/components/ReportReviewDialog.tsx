"use client";

/**
 * Report review modal for delegated features that have submitted a final
 * report. Shows the structured report (summary, test instructions,
 * hesitations, files, commits) and lets the user accept it (= ready to
 * merge) or reject + note (agent reopens the task).
 *
 * Backend: POST /api/actions/approve  { project, feature, scope: "report",
 *                                       reject?: boolean, note?: string }
 */
import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, X, AlertCircle } from "lucide-react";
import { openDialog } from "@/lib/imperative-dialog";
import { ThemeProvider } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DialogShell,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog-shell";
import * as actions from "@/lib/actions";
import type { FeatureState } from "@/lib/api";

type Report = NonNullable<FeatureState["latestReport"]>;

export function openReportReviewDialog(
  project: string,
  feature: string,
  report: Report,
  onDone?: () => void,
): void {
  openDialog((close) => (
    <ThemeProvider>
      <ReportReviewBody
        project={project}
        feature={feature}
        report={report}
        onDone={onDone}
        close={close}
      />
    </ThemeProvider>
  ));
}

function ReportReviewBody({
  project,
  feature,
  report,
  onDone,
  close,
}: {
  project: string;
  feature: string;
  report: Report;
  onDone?: () => void;
  close: () => void;
}): React.JSX.Element {
  const [submitting, setSubmitting] = React.useState(false);
  const [rejectMode, setRejectMode] = React.useState(false);
  const [note, setNote] = React.useState("");

  async function dispatchAccept() {
    setSubmitting(true);
    const r = await actions.approve(project, feature, "report");
    setSubmitting(false);
    if (r.ok) {
      toast.success(`Report accepted — ready to merge`);
      onDone?.();
      close();
    } else {
      toast.error("Accept failed", { description: r.error });
    }
  }

  async function dispatchReject() {
    if (!note.trim()) {
      toast.error("A rejection note is required");
      return;
    }
    setSubmitting(true);
    const r = await actions.approve(project, feature, "report", { reject: true, note: note.trim() });
    setSubmitting(false);
    if (r.ok) {
      toast.success(`Report rejected — agent will reopen`);
      onDone?.();
      close();
    } else {
      toast.error("Reject failed", { description: r.error });
    }
  }

  const statusBadge =
    report.status === "done" ? "success" :
    report.status === "blocked" ? "destructive" :
    report.status === "needs_review" ? "warning" :
    "muted";

  return (
    <DialogShell onClose={close} className="w-[min(95vw,46rem)]">
      <DialogHeader
        subtitle={`Submitted ${new Date(report.ts).toLocaleString()}`}
      >
        <div className="flex items-center gap-2">
          Report · <span className="font-mono">{feature}</span>
          <Badge variant={statusBadge as never}>{report.status}</Badge>
        </div>
      </DialogHeader>
      <DialogBody>
        {report.summary ? (
          <section className="space-y-1">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Summary
            </h3>
            <p className="text-sm leading-relaxed">{report.summary}</p>
          </section>
        ) : null}

        {report.testInstructions ? (
          <section className="space-y-1 pt-2 border-t border-border">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Test instructions
            </h3>
            <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed bg-card/40 rounded-md border border-border p-2.5">
              {report.testInstructions}
            </pre>
          </section>
        ) : null}

        {report.hesitations && report.hesitations.length > 0 ? (
          <section className="space-y-1 pt-2 border-t border-border">
            <h3 className="text-xs font-medium uppercase tracking-wider text-amber-500/80 flex items-center gap-1.5">
              <AlertCircle className="size-3.5" /> Hesitations
            </h3>
            <ul className="space-y-1">
              {report.hesitations.map((h, i) => (
                <li key={i} className="text-xs leading-relaxed text-muted-foreground">
                  • {h}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {report.openQuestions && report.openQuestions.length > 0 ? (
          <section className="space-y-1 pt-2 border-t border-border">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Open questions
            </h3>
            <ul className="space-y-1">
              {report.openQuestions.map((q, i) => (
                <li key={i} className="text-xs leading-relaxed">• {q}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {report.risks && report.risks.length > 0 ? (
          <section className="space-y-1 pt-2 border-t border-border">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Risks
            </h3>
            <ul className="space-y-1">
              {report.risks.map((r, i) => (
                <li key={i} className="text-xs leading-relaxed">• {r}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {report.filesChanged && report.filesChanged.length > 0 ? (
          <section className="space-y-1 pt-2 border-t border-border">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Files changed ({report.filesChanged.length})
            </h3>
            <ul className="font-mono text-[11px] text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
              {report.filesChanged.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {report.commits && report.commits.length > 0 ? (
          <section className="space-y-1 pt-2 border-t border-border">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Commits ({report.commits.length})
            </h3>
            <ul className="font-mono text-[11px] space-y-0.5">
              {report.commits.map((c, i) => (
                <li key={i}>
                  <span className="text-muted-foreground/60">{c.sha.slice(0, 7)}</span>{" "}
                  {c.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {rejectMode ? (
          <section className="space-y-2 pt-3 border-t border-border">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="reject-note">
              Why are you rejecting? <span className="text-emerald-500">*</span>
            </label>
            <Textarea
              id="reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. tests failing on the login page; OAuth callback missing"
              rows={3}
              className="text-xs"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground/70">
              The agent reopens the feature and gets your note via the Stop hook.
            </p>
          </section>
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
              {submitting ? "Rejecting…" : "Reject report"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => setRejectMode(true)} disabled={submitting} className="gap-1.5">
              <X className="size-4" /> Reject
            </Button>
            <Button onClick={dispatchAccept} disabled={submitting} className="gap-1.5">
              <CheckCircle2 className="size-4" />
              {submitting ? "Accepting…" : "Accept report"}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogShell>
  );
}
