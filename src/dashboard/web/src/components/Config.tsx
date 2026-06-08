/**
 * Config view — edit per-repo run config.
 *
 * Backend:
 *   GET /api/config/repos              → all projects + their repos
 *   POST /api/config/repos/run         → mutate one repo's run block
 *     body: { project, repo, run: { command, setup?, stopCommand?,
 *             presets?: Record<string,string>, activePreset? } }
 *
 * Per-repo we expose: command, setup, stopCommand, named presets, active
 * preset. Other fields (port, portEnv, env, composePorts, copyOnWorktree,
 * loadEnvFiles) stay file-managed for now — matches the legacy contract.
 */
import * as React from "react";
import { toast } from "sonner";
import { Save, Plus, X, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StackPicker, type TechProfile } from "@/components/ProjectWizard";

interface RepoConfig {
  name: string;
  type: "git" | "compose";
  path: string;
  tech?: string | null;
  baseBranch?: string | null;
  run: null | {
    command: string;
    setup?: string;
    stopCommand?: string;
    presets?: Record<string, string>;
    activePreset?: string;
    port?: number;
    portEnv?: string;
  };
}

interface ProjectCfg {
  name: string;
  repos: RepoConfig[];
}

interface ConfigData {
  projects: ProjectCfg[];
  configPath?: string;
}

interface RepoDraft {
  tech: string;
  command: string;
  setup: string;
  stopCommand: string;
  presets: Record<string, string>;
  activePreset: string;
}

function repoToDraft(r: RepoConfig): RepoDraft {
  return {
    tech: r.tech ?? "",
    command: r.run?.command ?? "",
    setup: r.run?.setup ?? "",
    stopCommand: r.run?.stopCommand ?? "",
    presets: r.run?.presets ? { ...r.run.presets } : {},
    activePreset: r.run?.activePreset ?? "",
  };
}

export interface ConfigProps {
  /** Active project — when set, the view scopes to this project's repos
   *  only. Without it (e.g. zero projects yet) the view falls back to
   *  showing every project's repos with a section per project. */
  projectName?: string | null;
  /** When set, scroll the matching repo card into view + briefly highlight it.
   *  Set by the sidebar when the user clicks a repo. */
  focusRepo?: { project: string; repo: string } | null;
  /** Called after the focus highlight has played, so the parent can clear
   *  the focus so the next click re-triggers. */
  onFocusConsumed?: () => void;
}

export function Config({ projectName, focusRepo, onFocusConsumed }: ConfigProps = {}): React.JSX.Element {
  const [data, setData] = React.useState<ConfigData | null>(null);
  const [profiles, setProfiles] = React.useState<TechProfile[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, RepoDraft>>({});
  const [highlightKey, setHighlightKey] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch("/api/config/repos");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `${r.status}`);
      setData(d);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  // Tech profiles for the per-card StackPicker. Fetched once; the list
  // doesn't change at runtime.
  React.useEffect(() => {
    fetch("/api/tech-profiles")
      .then((r) => r.json())
      .then((d) => setProfiles(d.profiles ?? []))
      .catch(() => { /* non-fatal — picker just renders empty */ });
  }, []);

  // Focus a specific repo card when the parent passes one in (sidebar click).
  // Waits one tick for the cards to render, then scrolls + briefly highlights.
  React.useEffect(() => {
    if (!focusRepo || !data) return;
    const key = `${focusRepo.project}/${focusRepo.repo}`;
    const el = document.querySelector<HTMLElement>(`[data-repo-key="${CSS.escape(key)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightKey(key);
      const t = window.setTimeout(() => {
        setHighlightKey(null);
        onFocusConsumed?.();
      }, 1600);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [focusRepo, data, onFocusConsumed]);

  function draftFor(project: string, repo: RepoConfig): RepoDraft {
    const key = `${project}/${repo.name}`;
    if (drafts[key]) return drafts[key]!;
    return repoToDraft(repo);
  }

  function updateDraft(project: string, repoName: string, patch: Partial<RepoDraft>) {
    const key = `${project}/${repoName}`;
    setDrafts((d) => {
      if (d[key]) return { ...d, [key]: { ...d[key], ...patch } };
      // First edit for this repo — seed the draft from the loaded config
      // instead of an empty object. Without this, toggling a single field
      // (e.g. clicking a preset radio) wiped command/setup/presets/etc.
      const repo = data?.projects
        .find((p) => p.name === project)
        ?.repos.find((r) => r.name === repoName);
      const seed = repo ? repoToDraft(repo) : ({} as RepoDraft);
      return { ...d, [key]: { ...seed, ...patch } };
    });
  }

  function resetDraft(project: string, repoName: string) {
    const key = `${project}/${repoName}`;
    setDrafts((d) => {
      const copy = { ...d };
      delete copy[key];
      return copy;
    });
  }

  async function save(project: string, repo: RepoConfig) {
    const key = `${project}/${repo.name}`;
    const draft = drafts[key];
    if (!draft) return;
    if (!draft.command.trim()) { toast.error("Command is required"); return; }

    // Meta first (tech) — if it fails we don't want a half-saved state.
    // Only post when the draft actually differs from disk.
    const techChanged = (draft.tech || "") !== (repo.tech || "");
    if (techChanged) {
      const metaRes = await fetch("/api/config/repos/meta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project, repo: repo.name, tech: draft.tech || "" }),
      });
      const metaJson = await metaRes.json().catch(() => ({}));
      if (!metaRes.ok || !metaJson.ok) {
        toast.error("Save failed", { description: metaJson.error ?? `${metaRes.status}` });
        return;
      }
    }

    const body = {
      project,
      repo: repo.name,
      run: {
        command: draft.command,
        ...(draft.setup ? { setup: draft.setup } : {}),
        ...(draft.stopCommand ? { stopCommand: draft.stopCommand } : {}),
        ...(Object.keys(draft.presets).length > 0 ? { presets: draft.presets } : {}),
        ...(draft.activePreset ? { activePreset: draft.activePreset } : {}),
      },
    };
    const r = await fetch("/api/config/repos/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await r.json().catch(() => ({}));
    if (r.ok && result.ok) {
      toast.success(`${project}/${repo.name} saved`);
      resetDraft(project, repo.name);
      await load();
    } else {
      toast.error("Save failed", { description: result.error ?? `${r.status}` });
    }
  }

  async function openConfigFile() {
    try {
      const r = await fetch("/api/config/open", { method: "POST" });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || !json.ok) {
        toast.error("Could not open config", { description: json.error ?? `${r.status}` });
      }
    } catch (err) {
      toast.error("Could not open config", { description: String(err) });
    }
  }

  if (error) return <ErrorPanel msg={error} />;
  if (!data) return <ConfigSkeleton />;

  // Filter to the active project when one is set; otherwise show every
  // project. The latter is the fallback for users who navigated to Config
  // before picking a project.
  const visibleProjects = projectName
    ? data.projects.filter((p) => p.name === projectName)
    : data.projects;
  const scoped = !!projectName && visibleProjects.length === 1;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 animate-fade-in">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {scoped ? (
            <>
              <span className="font-mono text-primary">{projectName}</span>{" "}
              <span className="text-muted-foreground font-normal">repos</span>
            </>
          ) : (
            "Config"
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          Config stored in{" "}
          <button
            type="button"
            onClick={openConfigFile}
            className="font-mono text-foreground underline-offset-4 hover:underline hover:text-primary transition-colors"
            title="Open this file in your default editor"
          >
            {data.configPath ?? "~/.config/banyan/config.yaml"}
          </button>
        </p>
      </header>

      {visibleProjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No project named <code className="text-foreground">{projectName}</code> in the config.
        </p>
      ) : null}

      {visibleProjects.map((p) => (
        <section key={p.name} className="space-y-3">
          {/* Hide the project header when scoped — the page title already names it. */}
          {scoped ? null : (
            <h2 className="text-lg font-semibold tracking-tight font-mono">{p.name}</h2>
          )}
          {p.repos.map((repo) => {
            const isCompose = repo.type === "compose";
            const draft = draftFor(p.name, repo);
            const dirty = !!drafts[`${p.name}/${repo.name}`];
            const repoKey = `${p.name}/${repo.name}`;
            const isHighlighted = highlightKey === repoKey;
            return (
              <Card
                key={repo.name}
                data-repo-key={repoKey}
                className={cn(
                  "transition-shadow duration-500",
                  isHighlighted && "ring-2 ring-emerald-500/60 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]",
                )}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{repo.name}</span>
                      {isCompose ? <Badge variant="info">compose</Badge> : null}
                      {repo.run?.port ? <Badge variant="muted">{repo.run.portEnv}={repo.run.port}</Badge> : null}
                    </div>
                    <div className="flex items-center gap-1">
                      {dirty ? (
                        <Button variant="ghost" size="sm" onClick={() => resetDraft(p.name, repo.name)}>
                          <RotateCcw className="size-4" />
                        </Button>
                      ) : null}
                      <Button size="sm" onClick={() => save(p.name, repo)} disabled={!dirty || isCompose} className="gap-1.5">
                        <Save className="size-4" /> Save
                      </Button>
                    </div>
                  </div>

                  {isCompose ? (
                    <p className="text-xs text-muted-foreground italic">
                      Compose repos are managed via docker-compose — no run command editor.
                    </p>
                  ) : (
                    <>
                      {profiles.length > 0 ? (
                        <div className="space-y-1.5">
                          <Label>Stack</Label>
                          <StackPicker
                            profiles={profiles}
                            selected={draft.tech}
                            onSelect={(id) => updateDraft(p.name, repo.name, { tech: id })}
                          />
                        </div>
                      ) : null}

                      <div className="space-y-1.5">
                        <Label>Command</Label>
                        <Input
                          className="font-mono"
                          value={draft.command}
                          onChange={(e) => updateDraft(p.name, repo.name, { command: e.target.value })}
                          placeholder="npm run dev"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label>Setup (one-shot)</Label>
                          <Input
                            className="font-mono"
                            value={draft.setup}
                            onChange={(e) => updateDraft(p.name, repo.name, { setup: e.target.value })}
                            placeholder="npm install"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Stop command</Label>
                          <Input
                            className="font-mono"
                            value={draft.stopCommand}
                            onChange={(e) => updateDraft(p.name, repo.name, { stopCommand: e.target.value })}
                            placeholder="./gradlew --stop"
                          />
                        </div>
                      </div>

                      <PresetsEditor
                        repoKey={repoKey}
                        presets={draft.presets}
                        activePreset={draft.activePreset}
                        defaultCommand={draft.command}
                        onPresets={(presets) => updateDraft(p.name, repo.name, { presets })}
                        onActive={(activePreset) => updateDraft(p.name, repo.name, { activePreset })}
                      />
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function PresetsEditor({
  repoKey,
  presets,
  activePreset,
  defaultCommand,
  onPresets,
  onActive,
}: {
  /** Stable id used as the radio-group `name` so the buttons in this
   *  card are mutually exclusive in plain HTML (each repo card has its
   *  own group). */
  repoKey: string;
  presets: Record<string, string>;
  activePreset: string;
  defaultCommand: string;
  onPresets: (p: Record<string, string>) => void;
  onActive: (a: string) => void;
}): React.JSX.Element {
  const [newName, setNewName] = React.useState("");
  const entries = Object.entries(presets);
  const groupName = `preset-${repoKey}`;

  function addPreset() {
    const name = newName.trim();
    if (!name) return;
    if (!/^[\w.-]+$/.test(name)) { toast.error("Preset name must match [A-Za-z0-9_.-]+"); return; }
    if (presets[name]) { toast.error("Preset already exists"); return; }
    onPresets({ ...presets, [name]: defaultCommand || "" });
    setNewName("");
  }

  function removePreset(name: string) {
    const copy = { ...presets };
    delete copy[name];
    onPresets(copy);
    if (activePreset === name) onActive("");
  }

  return (
    <div className="space-y-2 pt-2 border-t border-border">
      <div className="flex items-center justify-between">
        <Label>Named presets</Label>
        {entries.length > 0 ? (
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onActive("")}
            title="Disable presets — use the Command field above"
          >
            (use default command)
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground/80">
        Alternative commands you can switch between (e.g. <code className="text-foreground">android</code> / <code className="text-foreground">ios</code>, <code className="text-foreground">dev</code> / <code className="text-foreground">staging</code>). The selected radio overrides the Command field above when banyan launches this repo.
      </p>

      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic">No presets yet — type a name below and click Add to create one.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([name, cmd]) => (
            <div key={name} className="flex items-center gap-2">
              <input
                type="radio"
                name={groupName}
                checked={activePreset === name}
                onChange={() => onActive(name)}
                className="size-3.5 accent-primary"
                aria-label={`Use ${name}`}
              />
              <span className="font-mono text-xs w-20 truncate text-muted-foreground">{name}</span>
              <Input
                className="font-mono text-xs"
                value={cmd}
                onChange={(e) => onPresets({ ...presets, [name]: e.target.value })}
              />
              <Button variant="ghost" size="icon" onClick={() => removePreset(name)} title="Remove preset">
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-center pt-1">
        <Input
          className="font-mono text-xs"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="add a new preset (e.g. staging, prod)"
          onKeyDown={(e) => { if (e.key === "Enter") addPreset(); }}
        />
        <Button variant="outline" size="sm" onClick={addPreset} disabled={!newName.trim()} className="gap-1">
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </div>
  );
}

function ConfigSkeleton(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-3.5 w-96" />
      </header>
      {[0, 1].map((p) => (
        <section key={p} className="space-y-3">
          <Skeleton className="h-6 w-32" />
          {[0, 1].map((r) => (
            <Card key={r}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-9 w-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}

function ErrorPanel({ msg }: { msg: string }): React.JSX.Element {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="p-4 text-sm text-destructive-foreground">
          <strong>Error</strong>: {msg}
        </CardContent>
      </Card>
    </div>
  );
}
