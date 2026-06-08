"use client";

/**
 * "Add repo to existing project" dialog — companion to ProjectWizard but
 * scoped to a single repo, appended to a known project.
 *
 * Reuses RepoEditor (path probe, tech preset, advanced fields). The repo
 * name uniqueness check uses the list of already-configured repos for the
 * target project (fetched from /api/config/repos).
 *
 * Backend: POST /api/projects/:name/repos. Same payload shape as a single
 * entry in POST /api/projects' `repos` array.
 */
import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { openDialog } from "@/lib/imperative-dialog";
import { ThemeProvider } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  DialogShell,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog-shell";
import {
  RepoEditor,
  emptyDraft,
  type RepoData,
  type TechProfile,
} from "./ProjectWizard";

export function openAddRepoDialog(projectName: string, onAdded?: () => void): void {
  openDialog((close) => (
    <ThemeProvider>
      <AddRepoBody projectName={projectName} onAdded={onAdded} close={close} />
    </ThemeProvider>
  ));
}

function AddRepoBody({
  projectName,
  onAdded,
  close,
}: {
  projectName: string;
  onAdded?: () => void;
  close: () => void;
}): React.JSX.Element {
  const [profiles, setProfiles] = React.useState<TechProfile[]>([]);
  const [existingNames, setExistingNames] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState<RepoData>(emptyDraft());
  const [submitting, setSubmitting] = React.useState(false);

  // Tech profiles + existing repo names — fetched in parallel on open.
  React.useEffect(() => {
    fetch("/api/tech-profiles")
      .then((r) => r.json())
      .then((d) => setProfiles(d.profiles ?? []))
      .catch(() => toast.error("Could not load tech profiles"));

    fetch("/api/config/repos")
      .then((r) => r.json())
      .then((d) => {
        const proj = (d.projects ?? []).find(
          (p: { name: string }) => p.name === projectName,
        ) as { repos: Array<{ name: string }> } | undefined;
        setExistingNames(proj ? proj.repos.map((r) => r.name) : []);
      })
      .catch(() => {
        /* non-fatal — uniqueness validated server-side anyway */
      });
  }, [projectName]);

  async function submit(d: RepoData): Promise<void> {
    setSubmitting(true);
    const body = {
      name: d.name,
      path: d.path,
      ...(d.baseBranch ? { baseBranch: d.baseBranch } : {}),
      tech: d.tech,
      ...(d.run.command
        ? {
            run: {
              command: d.run.command,
              ...(d.run.port ? { port: d.run.port } : {}),
              ...(d.run.portEnv ? { portEnv: d.run.portEnv } : {}),
              ...(d.run.setup ? { setup: d.run.setup } : {}),
              ...(d.run.stopCommand ? { stopCommand: d.run.stopCommand } : {}),
            },
          }
        : {}),
    };

    try {
      const r = await fetch(
        `/api/projects/${encodeURIComponent(projectName)}/repos`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        toast.success(`Repo '${data.repo}' added to '${projectName}'`);
        onAdded?.();
        close();
      } else {
        toast.error("Add failed", { description: data.error ?? `${r.status}` });
        setSubmitting(false);
      }
    } catch (err) {
      toast.error("Add failed", { description: String(err) });
      setSubmitting(false);
    }
  }

  return (
    <DialogShell onClose={close} className="w-[min(95vw,38rem)]">
      <DialogHeader subtitle={`This repo will be appended to project '${projectName}' in the config.`}>
        Add repo
      </DialogHeader>

      <DialogBody>
        <RepoEditor
          profiles={profiles}
          existingNames={existingNames}
          draft={draft}
          onChange={setDraft}
          onCancel={close}
          onSave={submit}
          mode="add"
        />
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={close} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={() => submit(draft)}
          disabled={submitting || !draft.path || !draft.name || !draft.baseBranch}
          className="gap-1.5"
        >
          <CheckCircle2 className="size-4" />
          {submitting ? "Adding…" : "Add to project"}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}
