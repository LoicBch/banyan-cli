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
  Pencil,
  AlertCircle,
} from "lucide-react";
import { openDialog } from "@/lib/imperative-dialog";
import { ThemeProvider } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import {
  DialogShell,
  DialogHeader,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog-shell";
import { cn } from "@/lib/utils";
import { TechIcon } from "@/components/TechIcon";
import { apiFetch } from "@/lib/auth";

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
      <TooltipProvider delayDuration={200}>
        <WizardBody close={close} />
      </TooltipProvider>
    </ThemeProvider>
  ));
}

/** Small `(?)` icon with a hover tooltip — used to annotate optional
 *  / nuanced fields without cluttering the label. */
function HelpHint({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label="More info"
          className="inline-flex items-center text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <HelpCircle className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
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
  apiFetch("/api/tech-profiles")
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
      const r = await apiFetch("/api/projects", {
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
  const [probing, setProbing] = React.useState(false);
  const [probeResult, setProbeResult] = React.useState<"detected" | "unknown" | null>(
    // When editing an existing repo, treat it as "already detected" so we
    // don't show the "couldn't detect" warning on every edit.
    mode === "edit" && draft.tech !== "custom" ? "detected" : null,
  );

  // Re-run probe whenever the user blurs the path field (or hits Enter).
  // Smart defaults: probe fills name + tech + run config when it detects
  // something. The full form is shown unconditionally — every field is
  // optional past the required trio (path / name / baseBranch).
  async function probe(target?: string): Promise<void> {
    const p = (target ?? draft.path).trim();
    if (!p) return;
    setProbing(true);
    try {
      const r = await apiFetch("/api/fs/probe", {
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
        baseBranch: draft.baseBranch || (data.suggestedBaseBranch ?? ""),
        tech,
        run: {
          command: sug.command ?? draft.run.command,
          port: sug.port ?? draft.run.port,
          portEnv: sug.portEnv ?? draft.run.portEnv,
          setup: sug.setup ?? draft.run.setup,
          stopCommand: sug.stopCommand ?? draft.run.stopCommand,
        },
      });
      setProbeResult(data.suggestedTech ? "detected" : "unknown");
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
    if (!draft.baseBranch) {
      toast.error("Base branch is required");
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
        <Label htmlFor="repo-path">
          Path <span className="text-emerald-500">*</span>
        </Label>
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
              Couldn't auto-detect this stack. Confirm the fields below and
              pick a tech preset in Advanced if you want a starter run config.
            </span>
          </div>
        </div>
      ) : null}

      {/* Required fields — always visible above the Advanced toggle so the
       *  user never has to expand a section to set a mandatory field. The
       *  probe auto-fills both from the path (basename → name,
       *  `origin/HEAD` → baseBranch); user just confirms. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5 h-4">
            Repo name <span className="text-emerald-500">*</span>
          </Label>
          <Input
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value.trim() })}
            placeholder="front, back, app, …"
            className="font-mono text-xs h-8"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5 h-4">
            Base branch <span className="text-emerald-500">*</span>
            <HelpHint>
              Development branch that's the target of <code>bn merge</code> for
              this repo. banyan also rebases your feature onto it before pushing.
            </HelpHint>
          </Label>
          <Input
            value={draft.baseBranch}
            onChange={(e) => onChange({ ...draft, baseBranch: e.target.value.trim() })}
            placeholder="develop / main"
            className="font-mono text-xs h-8"
          />
        </div>
      </div>

      {/* All remaining fields are optional. Shown unconditionally — no
       *  Advanced disclosure — because users repeatedly complained about
       *  having to expand a section to see what banyan auto-detected. */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="space-y-1.5">
          <Label>Stack</Label>
          <StackPicker
            profiles={profiles}
            selected={draft.tech}
            onSelect={selectTech}
          />
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
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            Preferred port
            <HelpHint>
              banyan finds a free port nearby per feature. Set this to give
              each feature's run process a predictable port range (e.g. set
              3000 → first feature gets :3000, second :3001, …).
            </HelpHint>
          </Label>
          <Input
            type="number"
            value={draft.run.port ?? ""}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onChange({ ...draft, run: { ...draft.run, port: Number.isFinite(n) ? n : null } });
            }}
            placeholder="3000"
            className="font-mono text-xs h-8 w-32"
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={save} className="gap-1.5">
          {mode === "add" ? "Add to project" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── Stack picker (square cards) ──────────────────────────────────────────

/** Card grid for picking a tech stack. Each tile has the brand icon
 *  (Simple Icons paths inlined via TechIcon), the label below, and
 *  animates on selection (emerald ring + scale-103) and on click
 *  (brief scale-95 bounce). Compact size so it doesn't dominate a
 *  form crowded with other fields. */
export function StackPicker({
  profiles,
  selected,
  onSelect,
}: {
  profiles: TechProfile[];
  selected: string;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {profiles.map((p) => {
        const isSelected = p.id === selected;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            title={p.hint}
            className={cn(
              "group relative flex flex-col items-center justify-center gap-1 rounded-md border bg-card/40 px-2 py-2",
              "transition-all duration-200 ease-out active:scale-95",
              isSelected
                ? "border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/40 scale-[1.03]"
                : "border-border hover:border-primary/40 hover:bg-accent/40",
            )}
          >
            <TechIcon
              tech={p.id}
              branded={isSelected}
              className={cn(
                "size-5 transition-colors",
                isSelected ? "" : "text-muted-foreground group-hover:text-foreground",
              )}
            />
            <span
              className={cn(
                "text-[10px] font-medium transition-colors text-center leading-tight",
                isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
              )}
            >
              {p.label}
            </span>
            {isSelected ? (
              <span className="absolute top-1 right-1 size-1 rounded-full bg-emerald-500" />
            ) : null}
          </button>
        );
      })}
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
      const r = await apiFetch(url);
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
