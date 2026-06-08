"use client";

/**
 * "Create project" wizard — single-screen layout, inline repo editor,
 * smart defaults from path probe, progressive disclosure for advanced fields.
 *
 * UX goals (vs. the prior 3-step + sub-dialog version):
 *   - One dialog, no Step 1/2/3 navigation.
 *   - Repo editor lives in-place; clicking "+ Add repo" expands an inline
 *     form below the list rather than opening another dialog on top.
 *   - Probe auto-fills name + tech + run config on Path blur. Common case
 *     becomes: paste path → click Add → repeat. No manual tech picker
 *     needed when detection works.
 *   - Advanced fields (base branch, port, portEnv, stop command) hidden
 *     behind a toggle. Only the detected/required fields are visible.
 *
 * Backend (unchanged): GET /api/tech-profiles, GET /api/fs/list,
 * POST /api/fs/probe, POST /api/projects. All disabled in --remote mode.
 *
 * Keeps the same imperative entry point `openProjectWizard()` so callers
 * don't need to change.
 */
import * as React from "react";
import { toast } from "sonner";
import {
  Folder,
  FolderOpen,
  CheckCircle2,
  X,
  Plus,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Pencil,
  AlertCircle,
} from "lucide-react";
import { openDialog } from "@/lib/imperative-dialog";
import { ThemeProvider } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  DialogShell,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog-shell";
import { cn } from "@/lib/utils";

export interface TechProfile {
  id: string;
  label: string;
  hint: string;
  defaults: {
    command?: string;
    port?: number;
    portEnv?: string;
    setup?: string;
    stopCommand?: string;
  };
}

export interface RepoData {
  name: string;
  path: string;
  baseBranch: string;
  tech: string;
  run: {
    command: string;
    port: number | null;
    portEnv: string;
    setup: string;
    stopCommand: string;
  };
}

export function openProjectWizard(): void {
  openDialog((close) => (
    <ThemeProvider>
      <WizardBody close={close} />
    </ThemeProvider>
  ));
}

// ── Main wizard ──────────────────────────────────────────────────────────

function WizardBody({ close }: { close: () => void }): React.JSX.Element {
  const [name, setName] = React.useState("");
  const [repos, setRepos] = React.useState<RepoData[]>([]);
  const [profiles, setProfiles] = React.useState<TechProfile[]>([]);
  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Tech profiles fetched once per wizard open — small, doesn't change.
  React.useEffect(() => {
    fetch("/api/tech-profiles")
      .then((r) => r.json())
      .then((d) => setProfiles(d.profiles ?? []))
      .catch(() => toast.error("Could not load tech profiles"));
  }, []);

  function openAddEditor(): void {
    setEditor({ mode: "add", draft: emptyDraft() });
  }

  function openEditEditor(idx: number): void {
    setEditor({ mode: "edit", idx, draft: structuredClone(repos[idx]!) });
  }

  function cancelEditor(): void {
    setEditor(null);
  }

  function saveEditor(draft: RepoData): void {
    if (!editor) return;
    if (editor.mode === "add") {
      setRepos((r) => [...r, draft]);
    } else {
      setRepos((r) => r.map((x, i) => (i === editor.idx ? draft : x)));
    }
    setEditor(null);
  }

  function removeRepo(idx: number): void {
    setRepos((r) => r.filter((_, i) => i !== idx));
  }

  async function submit(): Promise<void> {
    if (!name) {
      toast.error("Project name is required");
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      toast.error("Name must match [A-Za-z0-9_.-]+");
      return;
    }
    if (repos.length === 0) {
      toast.error("Add at least one repo");
      return;
    }

    setSubmitting(true);
    const body = {
      name,
      repos: repos.map((r) => ({
        name: r.name,
        path: r.path,
        ...(r.baseBranch ? { baseBranch: r.baseBranch } : {}),
        tech: r.tech,
        ...(r.run.command
          ? {
              run: {
                command: r.run.command,
                ...(r.run.port ? { port: r.run.port } : {}),
                ...(r.run.portEnv ? { portEnv: r.run.portEnv } : {}),
                ...(r.run.setup ? { setup: r.run.setup } : {}),
                ...(r.run.stopCommand ? { stopCommand: r.run.stopCommand } : {}),
              },
            }
          : {}),
      })),
    };
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        toast.success(`Project '${data.name}' created`);
        close();
      } else {
        toast.error("Create failed", { description: data.error ?? `${r.status}` });
        setSubmitting(false);
      }
    } catch (err) {
      toast.error("Create failed", { description: String(err) });
      setSubmitting(false);
    }
  }

  return (
    <DialogShell onClose={close} className="w-[min(95vw,40rem)]">
      <DialogHeader subtitle="banyan will write the config and detect tech for each repo.">
        New project
      </DialogHeader>

      <DialogBody>
        {/* Project name */}
        <div className="space-y-1.5">
          <Label htmlFor="proj-name">Project name</Label>
          <Input
            id="proj-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.trim())}
            placeholder="myproject"
            className="font-mono"
          />
        </div>

        {/* Repos section */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <Label>Repos {repos.length > 0 ? `(${repos.length})` : ""}</Label>
            {repos.length === 0 && !editor ? (
              <span className="text-xs text-muted-foreground">add at least one</span>
            ) : null}
          </div>

          {/* Existing repo cards */}
          {repos.length > 0 ? (
            <div className="space-y-1.5">
              {repos.map((r, i) => (
                <RepoCard
                  key={`${r.name}-${i}`}
                  repo={r}
                  profile={profiles.find((p) => p.id === r.tech)}
                  onEdit={() => openEditEditor(i)}
                  onRemove={() => removeRepo(i)}
                  hidden={editor?.mode === "edit" && editor.idx === i}
                />
              ))}
            </div>
          ) : null}

          {/* Inline editor (replaces the Add button while open) */}
          {editor ? (
            <RepoEditor
              profiles={profiles}
              existingNames={repos
                .filter((_, i) => editor.mode !== "edit" || i !== editor.idx)
                .map((r) => r.name)}
              draft={editor.draft}
              onChange={(draft) => setEditor({ ...editor, draft })}
              onCancel={cancelEditor}
              onSave={saveEditor}
              mode={editor.mode}
            />
          ) : (
            <button
              onClick={openAddEditor}
              className={cn(
                "w-full rounded-lg border border-dashed border-border bg-card/30 px-4 py-3",
                "text-sm text-muted-foreground hover:bg-card hover:border-primary/40 hover:text-foreground",
                "transition-colors flex items-center justify-center gap-2",
              )}
            >
              <Plus className="size-4" />
              Add repo
            </button>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button
          onClick={submit}
          disabled={submitting || repos.length === 0 || !name}
          className="gap-1.5"
        >
          <CheckCircle2 className="size-4" />
          {submitting ? "Creating…" : "Create project"}
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}

interface EditorState {
  mode: "add" | "edit";
  idx?: number; // only when mode==="edit"
  draft: RepoData;
}

// ── Existing repo card ───────────────────────────────────────────────────

function RepoCard({
  repo,
  profile,
  onEdit,
  onRemove,
  hidden,
}: {
  repo: RepoData;
  profile: TechProfile | undefined;
  onEdit: () => void;
  onRemove: () => void;
  hidden?: boolean;
}): React.JSX.Element | null {
  if (hidden) return null;
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2.5 group hover:border-primary/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium">{repo.name}</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-xs text-muted-foreground">
              {profile?.label ?? repo.tech ?? "custom"}
            </span>
          </div>
          <div className="text-xs font-mono text-muted-foreground truncate">
            {repo.path}
          </div>
          {repo.run.command ? (
            <div className="text-xs font-mono text-muted-foreground truncate">
              <span className="text-muted-foreground/50">$ </span>
              {repo.run.command}
              {repo.run.port ? (
                <span className="text-muted-foreground/50"> ·:{repo.run.port}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" onClick={onEdit} className="size-7" title="Edit">
            <Pencil className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onRemove} className="size-7" title="Remove">
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Inline repo editor (Add or Edit) ─────────────────────────────────────

export function RepoEditor({
  profiles,
  existingNames,
  draft,
  onChange,
  onCancel,
  onSave,
  mode,
}: {
  profiles: TechProfile[];
  existingNames: string[];
  draft: RepoData;
  onChange: (d: RepoData) => void;
  onCancel: () => void;
  onSave: (d: RepoData) => void;
  mode: "add" | "edit";
}): React.JSX.Element {
  const [showAdvanced, setShowAdvanced] = React.useState(mode === "edit");
  const [probing, setProbing] = React.useState(false);
  const [probeResult, setProbeResult] = React.useState<"detected" | "unknown" | null>(
    // When editing an existing repo, treat it as "already detected" so we
    // don't show the "couldn't detect" warning on every edit.
    mode === "edit" && draft.tech !== "custom" ? "detected" : null,
  );

  // Re-run probe whenever the user blurs the path field (or hits Enter).
  // Smart defaults: probe fills name + tech + run config when it detects
  // something. Failing detection switches to manual mode (advanced fields
  // auto-expand).
  async function probe(target?: string): Promise<void> {
    const p = (target ?? draft.path).trim();
    if (!p) return;
    setProbing(true);
    try {
      const r = await fetch("/api/fs/probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      const data = await r.json();
      if (!r.ok || !data.valid) {
        setProbeResult("unknown");
        toast.error("Invalid path", { description: data.error ?? "rejected" });
        return;
      }
      const tech = data.suggestedTech ?? "custom";
      const profile = profiles.find((x) => x.id === tech);
      const sug = data.suggestedRun ?? profile?.defaults ?? {};
      onChange({
        ...draft,
        path: data.path,
        name: draft.name || data.suggestedName,
        tech,
        run: {
          command: sug.command ?? draft.run.command,
          port: sug.port ?? draft.run.port,
          portEnv: sug.portEnv ?? draft.run.portEnv,
          setup: sug.setup ?? draft.run.setup,
          stopCommand: sug.stopCommand ?? draft.run.stopCommand,
        },
      });
      if (data.suggestedTech) {
        setProbeResult("detected");
      } else {
        setProbeResult("unknown");
        // Auto-expand advanced so the user can fill manually.
        setShowAdvanced(true);
      }
    } catch (err) {
      setProbeResult("unknown");
      toast.error("Probe failed", { description: String(err) });
    } finally {
      setProbing(false);
    }
  }

  function selectTech(id: string): void {
    const profile = profiles.find((p) => p.id === id);
    onChange({
      ...draft,
      tech: id,
      run: {
        command: profile?.defaults.command ?? draft.run.command,
        port: profile?.defaults.port ?? draft.run.port,
        portEnv: profile?.defaults.portEnv ?? draft.run.portEnv,
        setup: profile?.defaults.setup ?? draft.run.setup,
        stopCommand: profile?.defaults.stopCommand ?? draft.run.stopCommand,
      },
    });
  }

  function save(): void {
    if (!draft.path) {
      toast.error("Path is required");
      return;
    }
    if (!draft.name) {
      toast.error("Repo name is required");
      return;
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(draft.name)) {
      toast.error("Repo name must match [A-Za-z0-9_.-]+");
      return;
    }
    if (existingNames.includes(draft.name)) {
      toast.error(`A repo named '${draft.name}' already exists`);
      return;
    }
    onSave(draft);
  }

  const profile = profiles.find((p) => p.id === draft.tech);

  return (
    <div className="rounded-lg border border-primary/40 bg-card/50 p-4 space-y-3 animate-fade-in">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" />
        {mode === "add" ? "New repo" : "Edit repo"}
      </div>

      {/* Path — the only required field for the happy path */}
      <div className="space-y-1.5">
        <Label htmlFor="repo-path">Path</Label>
        <div className="flex gap-2">
          <Input
            id="repo-path"
            autoFocus={mode === "add"}
            value={draft.path}
            onChange={(e) => {
              onChange({ ...draft, path: e.target.value });
              if (probeResult !== null) setProbeResult(null);
            }}
            onBlur={() => probe()}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder="~/Documents/Dev/MyApp/Front"
            className="font-mono flex-1"
          />
          <Button
            variant="outline"
            onClick={() => openFsBrowser((picked) => probe(picked))}
            className="gap-1.5 shrink-0"
            title="Browse filesystem"
          >
            <Folder className="size-4" />
            Browse
          </Button>
        </div>
      </div>

      {/* Detection badge — explains what banyan figured out */}
      {probing ? (
        <div className="text-xs text-muted-foreground">probing…</div>
      ) : probeResult === "detected" ? (
        <DetectionSummary profile={profile} draft={draft} />
      ) : probeResult === "unknown" ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="size-3.5 text-amber-500/80 mt-0.5 shrink-0" />
            <span className="text-muted-foreground">
              Couldn't auto-detect this stack. Fill the fields below manually
              or pick a tech preset.
            </span>
          </div>
        </div>
      ) : null}

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {showAdvanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Advanced fields
      </button>

      {/* Advanced fields */}
      {showAdvanced ? (
        <div className="space-y-3 pt-1 border-t border-border">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Repo name</Label>
              <Input
                value={draft.name}
                onChange={(e) => onChange({ ...draft, name: e.target.value.trim() })}
                placeholder="front, back, app, …"
                className="font-mono text-xs h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Base branch</Label>
              <Input
                value={draft.baseBranch}
                onChange={(e) => onChange({ ...draft, baseBranch: e.target.value.trim() })}
                placeholder="develop / main"
                className="font-mono text-xs h-8"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Tech preset</Label>
            <div className="flex flex-wrap gap-1.5">
              {profiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectTech(p.id)}
                  className={
                    p.id === draft.tech
                      ? "px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground"
                      : "px-2.5 py-1 text-xs rounded-md bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  }
                  title={p.hint}
                  type="button"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Run command</Label>
            <Input
              value={draft.run.command}
              onChange={(e) => onChange({ ...draft, run: { ...draft.run, command: e.target.value } })}
              placeholder="npm run dev"
              className="font-mono text-xs h-8"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Port</Label>
              <Input
                type="number"
                value={draft.run.port ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  onChange({ ...draft, run: { ...draft.run, port: Number.isFinite(n) ? n : null } });
                }}
                placeholder="3000"
                className="font-mono text-xs h-8"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Port env</Label>
              <Input
                value={draft.run.portEnv}
                onChange={(e) => onChange({ ...draft, run: { ...draft.run, portEnv: e.target.value.trim() } })}
                placeholder="PORT, SERVER_PORT"
                className="font-mono text-xs h-8"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Stop command (optional)</Label>
            <Input
              value={draft.run.stopCommand}
              onChange={(e) => onChange({ ...draft, run: { ...draft.run, stopCommand: e.target.value.trim() } })}
              placeholder="./gradlew --stop"
              className="font-mono text-xs h-8"
            />
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={save} className="gap-1.5">
          {mode === "add" ? "Add to project" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── Detection summary card ──────────────────────────────────────────────

function DetectionSummary({
  profile,
  draft,
}: {
  profile: TechProfile | undefined;
  draft: RepoData;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs space-y-1">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-3.5 text-emerald-500/80" />
        <span className="text-foreground">
          Detected:{" "}
          <span className="font-medium">{profile?.label ?? draft.tech}</span>
        </span>
        <Badge variant="muted" className="ml-auto text-[10px]">
          {draft.name}
        </Badge>
      </div>
      {draft.run.command ? (
        <div className="pl-5 font-mono text-muted-foreground truncate">
          {draft.run.command}
          {draft.run.port ? (
            <span className="text-muted-foreground/60"> · :{draft.run.port}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── FS browser sub-dialog (unchanged) ────────────────────────────────────

function openFsBrowser(onPick: (path: string) => void): void {
  openDialog((close) => (
    <ThemeProvider>
      <FsBrowserBody onPick={onPick} close={close} />
    </ThemeProvider>
  ));
}

function FsBrowserBody({
  onPick,
  close,
}: {
  onPick: (path: string) => void;
  close: () => void;
}): React.JSX.Element {
  const [path, setPath] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<
    Array<{ name: string; isDir: boolean; isGitRepo: boolean }>
  >([]);
  const [parent, setParent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load(target: string | null): Promise<void> {
    setError(null);
    try {
      const url =
        "/api/fs/list" + (target ? "?path=" + encodeURIComponent(target) : "");
      const r = await fetch(url);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `${r.status}`);
      setPath(data.path);
      setEntries(data.entries);
      setParent(data.parent);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  React.useEffect(() => {
    load(null);
  }, []);

  return (
    <DialogShell onClose={close} className="w-[min(95vw,36rem)]">
      <DialogHeader>Pick a directory</DialogHeader>
      <DialogBody>
        <div className="text-xs font-mono text-muted-foreground break-all">
          {path ?? "loading…"}
        </div>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        <div className="rounded-md border border-border divide-y divide-border max-h-72 overflow-y-auto">
          {parent ? (
            <button
              onClick={() => load(parent)}
              className="w-full px-3 py-1.5 text-left text-sm font-mono text-muted-foreground hover:bg-accent transition-colors"
            >
              ..
            </button>
          ) : null}
          {entries.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground italic">
              (empty)
            </div>
          ) : (
            entries.map((e) => (
              <button
                key={e.name}
                onClick={() => path && load(path + "/" + e.name)}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-accent transition-colors"
              >
                <span className="flex items-center gap-2 font-mono text-sm">
                  <FolderOpen className="size-3.5 text-muted-foreground/60" />
                  {e.name}
                </span>
                {e.isGitRepo ? <Badge variant="success">git</Badge> : null}
              </button>
            ))
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button
          onClick={() => {
            if (path) {
              onPick(path);
              close();
            }
          }}
          disabled={!path}
        >
          Pick this folder
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function emptyDraft(): RepoData {
  return {
    name: "",
    path: "",
    baseBranch: "",
    tech: "custom",
    run: {
      command: "",
      port: null,
      portEnv: "",
      setup: "",
      stopCommand: "",
    },
  };
}
