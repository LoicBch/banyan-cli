/**
 * Pipeline view — feature-first dashboard of a single project.
 *
 * Density: card per feature, mono ports + repo names, badges for mode and
 * status. Hover lifts the card subtly. Action menu (open / merge / cleanup)
 * is on the right.
 *
 * Empty states are first-class: no projects → big CTA. Project with no
 * features → onboarding hint.
 */
import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Play, GitMerge, Trash2, Terminal, Plus, FolderPlus, Square, MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchState, type DashboardState, type FeatureState, type ProjectState } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { cn } from "@/lib/utils";
import * as actions from "@/lib/actions";
import { confirm } from "@/lib/confirm";
import { useKeyboard } from "@/lib/useKeyboard";
import { openProjectWizard } from "@/components/ProjectWizard";
import { openWorktreeDialog } from "@/components/WorktreeDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface PipelineProps {
  projectName: string | null;
}

export function Pipeline({ projectName }: PipelineProps): React.JSX.Element {
  const { data, error, loading } = usePolling<DashboardState>(fetchState, 2000);

  if (loading && !data) return <PipelineSkeleton />;
  if (error && !data) return <ErrorState message={error} />;
  if (!data || data.projects.length === 0) return <NoProjectsState />;

  const project =
    data.projects.find((p) => p.name === projectName) ?? data.projects[0]!;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 animate-fade-in">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            Pipeline · {project.repos.length} {project.repos.length === 1 ? "repo" : "repos"}
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => openWorktreeDialog(project.name)}>
          <Plus className="size-4" />
          New feature
        </Button>
      </header>

      <FeatureList project={project} />
    </div>
  );
}

function FeatureList({ project }: { project: ProjectState }): React.JSX.Element {
  // Derive features from worktrees if /api/pipeline isn't surfaced in state.
  const features = deriveFeatures(project);

  // List nav: which card is "selected" (visible keyboard cursor).
  // Reset selection when the feature set changes (a feature gets removed by
  // cleanup, etc.) so we don't keep pointing at a stale index.
  const [selectedIdx, setSelectedIdx] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (selectedIdx !== null && selectedIdx >= features.length) {
      setSelectedIdx(features.length > 0 ? features.length - 1 : null);
    }
  }, [features.length, selectedIdx]);

  // Per-feature in-flight flag so two actions on the same card don't race
  // each other, while letting different cards run in parallel.
  const [busyByFeature, setBusyByFeature] = React.useState<Record<string, boolean>>({});

  async function runFeatureAction(
    feature: string,
    label: string,
    fn: () => Promise<actions.ActionResult>,
  ): Promise<void> {
    setBusyByFeature((s) => ({ ...s, [feature]: true }));
    const p = fn();
    toast.promise(p, {
      loading: `${label}…`,
      success: (r) => (r.ok ? `${label} ✓` : `${label} failed`),
      error: () => `${label} failed`,
    });
    const r = await p;
    setBusyByFeature((s) => ({ ...s, [feature]: false }));
    if (!r.ok && r.error) {
      toast.error(label, { description: r.error });
    }
  }

  function isFeatureRunning(f: FeatureState): boolean {
    const ports = f.ports ?? collectPortsFromRepos(project, f.feature);
    return ports.length > 0;
  }

  async function dispatchStart(f: FeatureState): Promise<void> {
    await runFeatureAction(f.feature, "Start", () =>
      actions.testStart(project.name, f.feature),
    );
  }
  async function dispatchStop(f: FeatureState): Promise<void> {
    await runFeatureAction(f.feature, "Stop", () =>
      actions.testStop(project.name, f.feature),
    );
  }
  async function dispatchMerge(f: FeatureState): Promise<void> {
    const repos = f.reposActive ?? reposWithWorktree(project, f.feature);
    const ok = await confirm({
      title: `Merge '${f.feature}'?`,
      description:
        "Banyan will rebase on the base branch, push, open an MR/PR, auto-resolve conflicts if any, then merge.",
      consequences: buildMergeConsequences(project, repos),
      confirmLabel: "Merge feature",
    });
    if (!ok) return;
    await runFeatureAction(f.feature, "Merge", () =>
      actions.merge(project.name, f.feature),
    );
  }
  async function dispatchCleanup(f: FeatureState): Promise<void> {
    const repos = f.reposActive ?? reposWithWorktree(project, f.feature);
    const ok = await confirm({
      title: `Cleanup '${f.feature}'?`,
      description: "Full teardown of the feature. This can't be undone.",
      consequences: buildCleanupConsequences(project, f.feature, repos),
      destructive: true,
      confirmLabel: "Delete everything",
    });
    if (!ok) return;
    await runFeatureAction(f.feature, "Cleanup", () =>
      actions.cleanup(project.name, f.feature),
    );
  }

  // ── Keyboard navigation (Tier 1) ──────────────────────────────────────
  // Pipeline-scoped bindings — registered only while this component is
  // mounted, so they don't fight other views' bindings. The `n` shortcut
  // (new feature) is App-level so it works from any view.
  useKeyboard({
    j: () => moveSelection(1),
    arrowdown: () => moveSelection(1),
    k: () => moveSelection(-1),
    arrowup: () => moveSelection(-1),
    escape: () => setSelectedIdx(null),
    s: () => {
      const f = selectedFeature();
      if (!f) return;
      if (busyByFeature[f.feature]) return;
      if (isFeatureRunning(f)) void dispatchStop(f);
      else void dispatchStart(f);
    },
    m: () => {
      const f = selectedFeature();
      if (!f || busyByFeature[f.feature]) return;
      void dispatchMerge(f);
    },
    c: () => {
      const f = selectedFeature();
      if (!f || busyByFeature[f.feature]) return;
      void dispatchCleanup(f);
    },
    a: () => {
      const f = selectedFeature();
      if (!f) return;
      onAttach(project.name);
    },
  });

  function moveSelection(delta: 1 | -1): void {
    setSelectedIdx((cur) => {
      if (features.length === 0) return null;
      if (cur === null) return delta > 0 ? 0 : features.length - 1;
      const next = cur + delta;
      if (next < 0) return 0;
      if (next >= features.length) return features.length - 1;
      return next;
    });
  }

  function selectedFeature(): FeatureState | null {
    if (selectedIdx === null) return null;
    return features[selectedIdx] ?? null;
  }

  if (features.length === 0) {
    return (
      <EmptyState
        icon={FolderPlus}
        title="No active features"
        description={
          <>
            Each feature spawns isolated worktrees in every repo of{" "}
            <span className="font-mono text-foreground">{project.name}</span>, with its own
            Claude agent and dynamically-allocated ports.
          </>
        }
        action={
          <Button onClick={() => openWorktreeDialog(project.name)} className="gap-1.5">
            <Plus className="size-4" />
            New feature
          </Button>
        }
        hint={
          <>
            Or via CLI:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
              bn {project.name} wt &lt;name&gt;
            </code>
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {features.map((f, i) => (
        <FeatureCard
          key={f.feature}
          feature={f}
          project={project}
          selected={i === selectedIdx}
          busy={!!busyByFeature[f.feature]}
          isRunning={isFeatureRunning(f)}
          onSelect={() => setSelectedIdx(i)}
          onStart={() => dispatchStart(f)}
          onStop={() => dispatchStop(f)}
          onMerge={() => dispatchMerge(f)}
          onCleanup={() => dispatchCleanup(f)}
          onAttach={() => onAttach(project.name)}
        />
      ))}
    </div>
  );
}

interface FeatureCardProps {
  feature: FeatureState;
  project: ProjectState;
  selected: boolean;
  busy: boolean;
  isRunning: boolean;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onMerge: () => void;
  onCleanup: () => void;
  onAttach: () => void;
}

function FeatureCard({
  feature,
  project,
  selected,
  busy,
  isRunning,
  onSelect,
  onStart,
  onStop,
  onMerge,
  onCleanup,
  onAttach,
}: FeatureCardProps): React.JSX.Element {
  const ports = feature.ports ?? collectPortsFromRepos(project, feature.feature);
  const reposTouched = feature.reposActive ?? reposWithWorktree(project, feature.feature);
  const todosPct = feature.todos && feature.todos.total > 0
    ? Math.round((feature.todos.done / feature.todos.total) * 100)
    : null;

  return (
    <Card
      onClick={onSelect}
      className={cn(
        "transition-all cursor-default",
        selected
          ? "border-primary/60 ring-2 ring-primary/30 shadow-md"
          : "hover:border-primary/40 hover:shadow-md",
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  "size-2 rounded-full shrink-0",
                  isRunning ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
                aria-label={isRunning ? "running" : "idle"}
              />
              <h3 className="font-mono text-sm font-medium truncate">{feature.feature}</h3>
              {feature.mode ? <Badge variant="muted">{feature.mode}</Badge> : null}
              {feature.stage && feature.stage !== "in-progress" ? <Badge variant="info">{feature.stage}</Badge> : null}
            </div>

            <div className="flex items-center gap-3 flex-wrap text-xs">
              {reposTouched.length > 0 ? (
                reposTouched.map((r) => {
                  const p = ports.find((x) => x.repo === r);
                  return (
                    <span key={r} className="inline-flex items-center gap-1 text-muted-foreground">
                      <span className="font-medium text-foreground">{r}</span>
                      {p ? <span className="font-mono">:{p.port}</span> : null}
                    </span>
                  );
                })
              ) : (
                <span className="text-muted-foreground italic">no active panes</span>
              )}
            </div>

            {todosPct !== null && feature.todos ? (
              <div className="flex items-center gap-2 text-xs">
                <div className="h-1 w-32 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all",
                      todosPct === 100 ? "bg-emerald-500" : "bg-primary",
                    )}
                    style={{ width: `${todosPct}%` }}
                  />
                </div>
                <span className="text-muted-foreground">
                  {feature.todos.done}/{feature.todos.total} todos
                </span>
              </div>
            ) : null}
          </div>

          {/* Action row: one primary (Start/Stop — the most-used) plus a
              ⋮ dropdown for the heavier ops. Solves the original "4 icons
              with equal weight" cramp where you couldn't tell from a glance
              which button mattered. */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isRunning ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onStop}
                disabled={busy}
                className="gap-1.5"
              >
                <Square className="size-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={onStart}
                disabled={busy}
                className="gap-1.5"
              >
                <Play className="size-3.5" />
                Start
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  disabled={busy}
                  aria-label="More actions"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={onAttach}>
                  <Terminal className="size-4" />
                  <span>Copy attach command</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onMerge}>
                  <GitMerge className="size-4" />
                  <span>Merge feature…</span>
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={onCleanup}>
                  <Trash2 className="size-4" />
                  <span>Cleanup feature…</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Action helpers ─────────────────────────────────────────────────────────

/** Copy the tmux attach command for the project to the clipboard. The
 *  dashboard can't itself attach the user to tmux — they're in a browser —
 *  so we give them the one-shot they need to paste in their terminal. */
function onAttach(projectName: string): void {
  const cmd = `bn ${projectName} attach`;
  navigator.clipboard
    .writeText(cmd)
    .then(() => {
      toast.success("Copied attach command", { description: cmd });
    })
    .catch(() => {
      // Fallback for browsers without clipboard API access (rare in 2026):
      // surface the command in the toast so the user can copy it manually.
      toast.info("Run this in your terminal", { description: cmd });
    });
}

// ── Consequence builders for confirm dialogs ──────────────────────────────

function buildCleanupConsequences(
  project: ProjectState,
  feature: string,
  reposTouched: string[],
): string[] {
  const out: string[] = [];
  if (reposTouched.length > 0) {
    out.push(
      `${reposTouched.length} worktree${reposTouched.length === 1 ? "" : "s"} removed (${reposTouched.join(", ")})`,
    );
    out.push(`branch feature/${feature} deleted in each repo`);
    out.push("agent pane closed");
  } else {
    out.push("worktrees removed across the project");
    out.push("feature branch deleted");
  }
  const hasCompose = project.repos.some((r) => r.type === "compose");
  if (hasCompose) {
    out.push("compose stack destroyed (volumes dropped — DB data lost)");
  }
  out.push("running test processes stopped");
  return out;
}

function buildMergeConsequences(project: ProjectState, reposTouched: string[]): string[] {
  const repos = reposTouched.length > 0
    ? reposTouched
    : project.repos.filter((r) => r.type !== "compose").map((r) => r.name);
  return [
    `${repos.length} repo${repos.length === 1 ? "" : "s"} rebased + pushed (${repos.join(", ")})`,
    "MR/PR created and merged with the repo's configured strategy",
    "uncommitted changes in the worktree are auto-committed before push",
  ];
}

// ── Derive features from /api/state when /api/pipeline isn't joined in ────

function deriveFeatures(project: ProjectState): FeatureState[] {
  if (project.features && project.features.length > 0) return project.features;

  // Build a feature list from worktrees across repos.
  const map = new Map<string, FeatureState>();
  for (const repo of project.repos) {
    for (const wt of repo.worktrees) {
      if (!map.has(wt.feature)) {
        map.set(wt.feature, { feature: wt.feature, reposActive: [] });
      }
      map.get(wt.feature)!.reposActive!.push(repo.name);
    }
  }
  return Array.from(map.values());
}

function reposWithWorktree(project: ProjectState, feature: string): string[] {
  const out: string[] = [];
  for (const repo of project.repos) {
    if (repo.worktrees.some((wt) => wt.feature === feature)) out.push(repo.name);
  }
  return out;
}

function collectPortsFromRepos(project: ProjectState, feature: string): Array<{ repo: string; port: number }> {
  const out: Array<{ repo: string; port: number }> = [];
  for (const repo of project.repos) {
    const stack = repo.stacks.find((s) => s.feature === feature && s.running);
    if (stack?.hostPorts && stack.hostPorts.length > 0) {
      out.push({ repo: repo.name, port: stack.hostPorts[0]!.port });
    }
  }
  return out;
}

// ── States ───────────────────────────────────────────────────────────────

function PipelineSkeleton(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-3.5 w-32" />
        </div>
        <Skeleton className="h-8 w-28" />
      </header>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <FeatureCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function FeatureCardSkeleton(): React.JSX.Element {
  // Mirror the shape of <FeatureCard> so the layout doesn't jump when data
  // arrives: status dot, feature name, mode badge, repo+port row, actions.
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex items-center gap-2">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-16" />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-16" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-1 w-32 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Skeleton className="size-9" />
            <Skeleton className="size-9" />
            <Skeleton className="size-9" />
            <Skeleton className="size-9" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="p-4 text-sm text-destructive-foreground">
          <strong>Error</strong>: {message}
        </CardContent>
      </Card>
    </div>
  );
}

function NoProjectsState(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-2xl p-6 mt-12">
      <EmptyState
        icon={FolderPlus}
        iconTone="accent"
        title="No projects yet"
        description="A banyan project groups the repos that ship together. The wizard scans each repo, detects the tech (Node, Spring Boot, Android, …), and writes the config for you."
        action={
          <Button onClick={openProjectWizard} className="gap-2">
            <Plus className="size-4" />
            Create your first project
          </Button>
        }
        hint={
          <>
            Or via CLI:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
              cd my-front && bn init my-project
            </code>
          </>
        }
      />
    </div>
  );
}
