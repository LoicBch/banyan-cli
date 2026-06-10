"use client";

/**
 * Quick "send a prompt to the agent" modal — the dashboard's equivalent of
 * the removed `bn task` CLI. Used to intervene mid-pipeline without
 * leaving the browser: ask the agent to fix something, clarify a
 * decision, push a follow-up requirement.
 *
 * Backend: POST /api/actions/task → tmux paste-and-submit into the
 * feature's agent pane via `assignTask`.
 */
import * as React from "react";
import { toast } from "sonner";
import { Send, TerminalSquare } from "lucide-react";
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

export function openSendMessageDialog(
  project: string,
  feature: string,
  opts: { localMode?: boolean; prefill?: string } = {},
): void {
  openDialog((close) => (
    <ThemeProvider>
      <SendMessageBody
        project={project}
        feature={feature}
        localMode={opts.localMode}
        prefill={opts.prefill}
        close={close}
      />
    </ThemeProvider>
  ));
}

function SendMessageBody({
  project,
  feature,
  localMode,
  prefill,
  close,
}: {
  project: string;
  feature: string;
  localMode?: boolean;
  prefill?: string;
  close: () => void;
}): React.JSX.Element {
  const [prompt, setPrompt] = React.useState(prefill ?? "");
  const [submitting, setSubmitting] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    textareaRef.current?.focus();
    // Place cursor at end when there's a prefill so the user can keep typing.
    if (prefill && textareaRef.current) {
      const el = textareaRef.current;
      el.selectionStart = el.selectionEnd = el.value.length;
    }
  }, [prefill]);

  async function submit() {
    if (!prompt.trim()) {
      toast.error("Message can't be empty");
      return;
    }
    setSubmitting(true);
    const r = await actions.sendTask(project, feature, prompt.trim());
    setSubmitting(false);
    if (r.ok) {
      toast.success(`Message sent to ${feature}`);
      close();
    } else {
      toast.error("Send failed", { description: r.error });
    }
  }

  async function openInTerminal() {
    const r = await actions.openTerminal(project);
    if (r.ok) {
      toast.success(
        r.attachedToExisting
          ? "Switch to your terminal — session already attached"
          : `Terminal opened${r.terminal ? ` (${r.terminal})` : ""}`,
      );
      close();
    } else {
      toast.error("Couldn't open terminal", { description: r.error });
    }
  }

  return (
    <DialogShell onClose={close} className="w-[min(95vw,36rem)]">
      <DialogHeader subtitle={`Paste-and-submits into the agent's tmux pane for '${feature}'`}>
        Send message to agent
      </DialogHeader>
      <DialogBody>
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. the login test is failing on the OAuth callback URL — fix it and re-run the suite"
          rows={6}
          className="font-mono text-sm"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
        />
        <p className="text-[11px] text-muted-foreground/80">
          ⌘+Enter (or Ctrl+Enter) to send.
          {localMode === true ? (
            <>
              {" "}For deeper interaction, open the agent's pane directly:{" "}
              <button
                onClick={openInTerminal}
                className="inline-flex items-center gap-1 text-emerald-500 hover:underline"
              >
                <TerminalSquare className="size-3" /> open in terminal
              </button>
              .
            </>
          ) : null}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={submitting || !prompt.trim()} className="gap-1.5">
          <Send className="size-4" />
          {submitting ? "Sending…" : "Send"}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}
