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
  Play, GitMerge, Trash2, Terminal, Plus, FolderPlus, Square, MoreHorizontal, TerminalSquare, MessageSquare,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchState, fetchPipeline, type DashboardState, type FeatureState, type ProjectState } from "@/lib/api";
import { openPlanReviewDialog } from "@/components/PlanReviewDialog";
import { openReportReviewDialog } from "@/components/ReportReviewDialog";
import { openSendMessageDialog } from "@/components/SendMessageDialog";
import { StageIndicator } from "@/components/StageIndicator";
import { usePolling } from "@/lib/usePolling";
import { cn } from "@/lib/utils";
import * as actions from "@/lib/actions";
import { confirm } from "@/lib/confirm";
import { useKeyboard } from "@/lib/useKeyboard";
import { openProjectWizard } from "@/components/ProjectWizard";
import { openAddRepoDialog } from "@/components/AddRepoDialog";
import { openWorktreeDialog } from "@/components/WorktreeDialog";
import { TechIcon } from "@/components/TechIcon";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface PipelineProps {
  projectName: string | null;
  /** Click on a repo chip — defers to the parent so it can switch
   *  the section to Config + focus the matching card (same path as
   *  the sidebar repo click). */
  onRepoClick?: (projectName: string, repoName: string) => void;
}

export function Pipeline({ projectName, onRepoClick }: PipelineProps): React.JSX.Element {
  const { data, error, loading } = usePolling<DashboardState>(fetchState, 2000);

  // Pipeline data (approval state, latest report, …) is served by a
  // separate endpoint so it's not bundled into every /api/state response.
  // Joined here on the active project — keeps the feature cards rich.
  const activeName = projectName ?? data?.projects[0]?.name ?? null;
  const fetchPipelineForActive = React.useCallback(() => {
    if (!activeName) return Promise.resolve({ features: [] });
    return fetchPipeline(activeName);
  }, [activeName]);
  const { data: pipelineData } = usePolling(fetchPipelineForActive, 2000);

  if (loading && !data) return <PipelineSkeleton />;
  if (error && !data) return <ErrorState message={error} />;
  if (!data || data.projects.length === 0) return <NoProjectsState />;

  const project =
    data.projects.find((p) => p.name === projectName) ?? data.projects[0]!;
  const pipelineFeatures = pipelineData?.features ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6 animate-fade-in">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            Pipeline · {project.repos.length} {project.repos.length === 1 ? "repo" : "repos"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.localMode === true ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={async () => {
                const r = await actions.openTerminal(project.name);
                if (r.ok) {
                  toast.success(
                    r.attachedToExisting
                      ? "Switch to your terminal — session already attached"
                      : `Terminal opened${r.terminal ? ` (${r.terminal})` : ""}`,
                  );
                } else {
                  toast.error("Couldn't open terminal", { description: r.error });
                }
              }}
              title="Open a native terminal attached to this project's tmux session"
            >
              <TerminalSquare className="size-4" />
              Open in terminal
            </Button>
          ) : null}
          <Button size="sm" className="gap-2" onClick={() => openWorktreeDialog(project.name)}>
            <Plus className="size-4" />
            New feature
          </Button>
        </div>
      </header>

      <FeatureList
        project={project}
        pipelineFeatures={pipelineFeatures}
        localMode={data.localMode === true}
      />

      <RepoChipRow project={project} onRepoClick={onRepoClick} />
    </div>
  );
}

/** Ultra-compact horizontal row of repo "chips" — inventory only.
 *  Each chip = brand icon + name, clickable to drill into Config.
 *  Trailing "+" opens AddRepoDialog. Deliberately not a full list:
 *  the heavy editing UI lives in Config, this is just "what's in
 *  this project at a glance." */
function RepoChipRow({
  project,
  onRepoClick,
}: {
  project: ProjectState;
  onRepoClick?: (projectName: string, repoName: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 pt-2 border-t border-border/50">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70 shrink-0">
        Repos
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {project.repos.map((r) => (
          <button
            key={r.name}
            onClick={() => onRepoClick?.(project.name, r.name)}
            title={`${r.path} — click to open config`}
            className="group flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-2 py-1 text-xs font-mono text-muted-foreground hover:border-primary/40 hover:bg-accent/40 hover:text-foreground transition-colors"
          >
            <TechIcon tech={r.tech} type={r.type} className="text-muted-foreground/70 group-hover:text-foreground transition-colors" />
            {r.name}
          </button>
        ))}
        <button
          onClick={() => openAddRepoDialog(project.name)}
          title="Add a repo to this project"
          className="flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-500 hover:border-emerald-500/60 hover:bg-emerald-500/20 transition-colors"
        >
          <FolderPlus className="size-3.5" />
          Add repo
        </button>
      </div>
    </div>
  );
}

function FeatureList({
  project,
  pipelineFeatures,
  localMode,
}: {
  project: ProjectState;
  pipelineFeatures: FeatureState[];
  localMode: boolean;
}): React.JSX.Element {
  // Merge the basic feature list (from /api/state worktrees) with the
  // richer pipeline view (/api/pipeline). Pipeline rows win when they
  // exist — they carry approval / latestReport / reportApproval that
  // the state endpoint doesn't surface.
  const baseFeatures = deriveFeatures(project);
  const pipelineByName = new Map(pipelineFeatures.map((f) => [f.feature, f]));
  const features = baseFeatures.map((bf) => {
    const pf = pipelineByName.get(bf.feature);
    return pf ? { ...bf, ...pf } : bf;
  });
  // Also surface pipeline features that aren't in the basic list (e.g.
  // merged/cleaned-up but still in approval history) — usually empty.
  for (const pf of pipelineFeatures) {
    if (!features.find((f) => f.feature === pf.feature)) {
      features.push(pf);
    }
  }

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
  ): Promise<actions.ActionResult> {
    setBusyByFeature((s) => ({ ...s, [feature]: true }));
    // Sonner-style loading-then-update: one toast, no flicker, no
    // "success" envelope wrapping a failed result (the previous
    // toast.promise variant printed both "Cleanup failed" with a green
    // border and an error toast underneath).
    const id = toast.loading(`${label}…`);
    let r: actions.ActionResult;
    try {
      r = await fn();
    } catch (err) {
      r = { ok: false, error: String(err) };
    }
    setBusyByFeature((s) => ({ ...s, [feature]: false }));
    if (r.ok) {
      toast.success(`${label} ✓`, { id });
    } else {
      toast.error(label, { id, description: r.error });
    }
    return r;
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
  // Project-level terminal launch — surfaces a single iTerm/Warp/…
  // window attached to the session. If a client is already attached we
  // just bring the existing window to front (no second window).
  async function dispatchOpenInTerminal(): Promise<void> {
    const r = await actions.openTerminal(project.name);
    if (r.ok) {
      toast.success(
        r.attachedToExisting
          ? "Switch to your terminal — session already attached"
          : `Terminal opened${r.terminal ? ` (${r.terminal})` : ""}`,
      );
    } else {
      toast.error("Couldn't open terminal", { description: r.error });
    }
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

    const r = await runFeatureAction(f.feature, "Cleanup", () =>
      actions.cleanup(project.name, f.feature),
    );

    // Dirty-worktree path: `git worktree remove` refuses without --force when
    // there are modified or untracked files. Show a confirm to retry with
    // force=true so the user can blow it away from the dashboard instead of
    // dropping back to the CLI.
    if (!r.ok && r.error && /modified or untracked|use --force/i.test(r.error)) {
      const forceOk = await confirm({
        title: `Force cleanup '${f.feature}'?`,
        description:
          "This worktree has uncommitted changes or untracked files. Force-deleting will discard them — they can't be recovered.",
        destructive: true,
        confirmLabel: "Force delete",
      });
      if (!forceOk) return;
      await runFeatureAction(f.feature, "Cleanup (force)", () =>
        actions.cleanup(project.name, f.feature, { force: true }),
      );
    }
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
      void dispatchOpenInTerminal();
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
          localMode={localMode}
          onSelect={() => setSelectedIdx(i)}
          onStart={() => dispatchStart(f)}
          onStop={() => dispatchStop(f)}
          onMerge={() => dispatchMerge(f)}
          onCleanup={() => dispatchCleanup(f)}
          onOpenInTerminal={() => dispatchOpenInTerminal()}
          onSendMessage={() =>
            openSendMessageDialog(project.name, f.feature, { localMode })
          }
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
  /** True in local mode — gates the "Open in terminal" menu item. */
  localMode: boolean;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onMerge: () => void;
  onCleanup: () => void;
  onOpenInTerminal: () => void;
  onSendMessage: () => void;
}

function FeatureCard({
  feature,
  project,
  selected,
  busy,
  isRunning,
  localMode,
  onSelect,
  onStart,
  onStop,
  onMerge,
  onCleanup,
  onOpenInTerminal,
  onSendMessage,
}: FeatureCardProps): React.JSX.Element {
  const ports = feature.ports ?? collectPortsFromRepos(project, feature.feature);
  const reposTouched = feature.reposActive ?? reposWithWorktree(project, feature.feature);
  // Pipeline data may surface todo under `todo` (new) OR `todos` (legacy).
  // Normalize to a shared shape so the progress bar code below stays simple.
  const todo = feature.todo ?? (feature.todos
    ? { total: feature.todos.total, done: feature.todos.done }
    : undefined);
  const todosPct = todo && todo.total > 0
    ? Math.round((todo.done / todo.total) * 100)
    : null;

  // Delegated-pipeline gates pending action.
  const planPending = feature.approval?.status === "pending";
  const reportPending =
    !!feature.latestReport &&
    feature.latestReport.status === "done" &&
    feature.reportApproval?.status === "pending";

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

            {todosPct !== null && todo ? (
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
                  {todo.done}/{todo.total} todos
                </span>
              </div>
            ) : null}

            <StageIndicator feature={feature} />

            {/* Delegated-pipeline gate buttons — surface visibly when the
             *  user needs to act. Emerald = "your move", same vocabulary as
             *  the sidebar "+ NEW" and the "+ Add repo" pill. */}
            {planPending || reportPending ? (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                {planPending ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openPlanReviewDialog(project.name, feature.feature);
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-500 hover:border-emerald-500/70 hover:bg-emerald-500/20 transition-colors"
                  >
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Review plan
                  </button>
                ) : null}
                {reportPending && feature.latestReport ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openReportReviewDialog(project.name, feature.feature, feature.latestReport!);
                    }}
                    className="flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-500 hover:border-emerald-500/70 hover:bg-emerald-500/20 transition-colors"
                  >
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Review report
                  </button>
                ) : null}
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
            {/* Live-intervention shortcut. Always available on a feature —
                lets the user jump out of the gated pipeline at any stage to
                talk to the agent directly without leaving the dashboard. */}
            <Button
              variant="outline"
              size="icon"
              className="size-9"
              onClick={onSendMessage}
              disabled={busy}
              aria-label="Send message to agent"
              title="Send a follow-up prompt to the agent"
            >
              <MessageSquare className="size-4" />
            </Button>
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
                {localMode ? (
                  <>
                    <DropdownMenuItem onSelect={onOpenInTerminal}>
                      <TerminalSquare className="size-4" />
                      <span>Open in terminal</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                ) : null}
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
