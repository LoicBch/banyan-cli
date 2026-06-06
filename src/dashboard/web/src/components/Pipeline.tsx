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
import { Play, GitMerge, Trash2, ExternalLink, Plus, FolderPlus, Square } from "lucide-react";
import { fetchState, type DashboardState, type FeatureState, type ProjectState } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { cn } from "@/lib/utils";
import * as actions from "@/lib/actions";
import { openProjectWizard } from "@/components/ProjectWizard";
import { openWorktreeDialog } from "@/components/WorktreeDialog";

interface PipelineProps {
  projectName: string | null;
}

export function Pipeline({ projectName }: PipelineProps): React.JSX.Element {
  const { data, error, loading } = usePolling<DashboardState>(fetchState, 2000);

  if (loading && !data) return <Skeleton />;
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

  if (features.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center space-y-3">
          <div className="mx-auto w-fit rounded-full bg-muted p-3">
            <FolderPlus className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-medium">No active features</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Spin up a feature with{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">bn {project.name} wt &lt;name&gt;</code>{" "}
            or click "New feature" above.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {features.map((f) => (
        <FeatureCard key={f.feature} feature={f} project={project} />
      ))}
    </div>
  );
}

function FeatureCard({ feature, project }: { feature: FeatureState; project: ProjectState }): React.JSX.Element {
  const ports = feature.ports ?? collectPortsFromRepos(project, feature.feature);
  const reposTouched = feature.reposActive ?? reposWithWorktree(project, feature.feature);
  const todosPct = feature.todos && feature.todos.total > 0
    ? Math.round((feature.todos.done / feature.todos.total) * 100)
    : null;
  const isRunning = ports.length > 0;
  const [busy, setBusy] = React.useState(false);

  // Each action wraps the corresponding /api/actions/* call with toast feedback.
  // `busy` disables all buttons while one is in flight to avoid spamming the
  // backend (cleanup in particular is destructive).
  async function runAction(label: string, fn: () => Promise<actions.ActionResult>) {
    setBusy(true);
    const p = fn();
    toast.promise(p, {
      loading: `${label}…`,
      success: (r) => (r.ok ? `${label} ✓` : `${label} failed`),
      error: () => `${label} failed`,
    });
    const r = await p;
    setBusy(false);
    if (!r.ok && r.error) {
      // Append a second toast with the actual error message — sonner's
      // success/error already shows the headline.
      toast.error(label, { description: r.error });
    }
  }

  const onStart = () => runAction("Start", () => actions.testStart(project.name, feature.feature));
  const onStop = () => runAction("Stop", () => actions.testStop(project.name, feature.feature));
  const onMerge = () => runAction("Merge", () => actions.merge(project.name, feature.feature));
  const onCleanup = () => {
    if (!window.confirm(`Cleanup '${feature.feature}'? This removes worktrees + deletes the branch + stops tests.`)) return;
    runAction("Cleanup", () => actions.cleanup(project.name, feature.feature));
  };

  return (
    <Card className="hover:border-primary/40 hover:shadow-md transition-all">
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

          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" title="Open agent pane (attach tmux)"
              onClick={() => toast.info("Attach to the project session in your terminal", {
                description: `bn ${project.name} attach`,
              })}
              disabled={busy}>
              <ExternalLink className="size-4" />
            </Button>
            {isRunning ? (
              <Button variant="ghost" size="icon" title="Stop run processes" onClick={onStop} disabled={busy}>
                <Square className="size-4" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" title="Start run processes" onClick={onStart} disabled={busy}>
                <Play className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" title="Merge feature" onClick={onMerge} disabled={busy}>
              <GitMerge className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" title="Cleanup feature" onClick={onCleanup} disabled={busy}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
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

function Skeleton(): React.JSX.Element {
  return (
    <div className="mx-auto max-w-5xl p-6 space-y-3">
      <div className="h-8 w-48 rounded bg-muted animate-pulse" />
      <div className="h-4 w-32 rounded bg-muted animate-pulse" />
      <div className="space-y-3 mt-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-lg bg-muted/50 animate-pulse" />
        ))}
      </div>
    </div>
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
    <div className="mx-auto max-w-2xl p-6 mt-12 animate-fade-in">
      <Card className="border-dashed">
        <CardContent className="py-12 text-center space-y-4">
          <div className="mx-auto w-fit rounded-full bg-primary/10 p-4">
            <FolderPlus className="size-8 text-primary" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold">No projects yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Get started by creating one — banyan will write the config and detect tech for each repo.
            </p>
          </div>
          <Button className="gap-2" onClick={openProjectWizard}>
            <Plus className="size-4" />
            Create project
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
