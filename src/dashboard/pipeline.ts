/**
 * Pipeline view aggregator — for each active feature in a project, computes
 * a structured "lifecycle" state combining the data already exposed by the
 * dashboard's smaller endpoints (worktrees, todos, approvals, reports).
 *
 * The frontend renders this as a horizontal pipeline per feature so the
 * user can see at a glance where each feature is in its journey:
 *
 *   created → plan → approval → working → reported → merged
 *
 * "Off-pipeline" states (rejected, blocked, needs_review) are surfaced
 * separately on the same row so the user knows what action is needed.
 */
import type { ProjectConfig } from "../config.js";
import * as git from "../git.js";
import * as naming from "../naming.js";
import { getTodo, type FeatureTodo } from "../todo.js";
import { getApproval, approvalStatus, type ApprovalState, type ApprovalStatus } from "../approval.js";
import { readReports, type FeatureReport } from "../reports.js";

/** Linear stages every feature passes through, in order. */
export type PipelineStage =
  | "created"          // worktree exists, no plan / work yet
  | "planning"         // todo started but no approval requested (when applicable)
  | "approval"         // approval pending review
  | "working"          // approved or no-review path; todo in progress
  | "reported"         // at least one done report; todo complete (if any)
  | "merged";          // worktree no longer exists (assumed merged or wt-rm'd)

/** Off-pipeline error/attention states. Surfaced alongside `stage` so the
 *  user knows the feature is stuck or needs action. */
export type PipelineFlag =
  | "rejected"        // approval.status = rejected, agent revising
  | "blocked"         // latest report status = blocked
  | "needs_review";   // latest report status = needs_review

export interface PipelineEntry {
  feature: string;
  /** Repos where this feature has a worktree on disk. Empty = the feature's
   *  worktrees were all cleaned up (likely merged or wt-rm'd). */
  repos: string[];
  stage: PipelineStage;
  /** 0 = first stage (created), 5 = last (merged). Used to render the
   *  pipeline's progress fill. */
  stageIndex: number;
  flag?: PipelineFlag;
  todo?: { total: number; done: number; updatedAt: string };
  approval?: { status: ApprovalStatus; planSubmittedAt: string | null; approvedAt: string | null; rejectionNote: string | null };
  latestReport?: FeatureReport;
}

const STAGES: PipelineStage[] = [
  "created",
  "planning",
  "approval",
  "working",
  "reported",
  "merged",
];

export const PIPELINE_STAGES = STAGES;

/** Build the full pipeline view for a project: one entry per feature ever
 *  observed (active + cleaned). */
export async function buildPipeline(project: ProjectConfig): Promise<PipelineEntry[]> {
  // Discover features:
  //   1. Live ones from `git worktree list` on each git repo.
  //   2. Cleaned ones: features that have a report or todo or approval but
  //      no worktree on disk anymore.
  const liveFeatures = new Map<string, string[]>(); // feature -> repo names
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    const wts = await git.worktreeList(repo.path).catch(() => []);
    for (const wt of wts) {
      if (wt.path === repo.path) continue;
      const parsed = naming.parseWorktreePath(wt.path, repo.path);
      if (!parsed) continue;
      const list = liveFeatures.get(parsed.feature) ?? [];
      list.push(repo.name);
      liveFeatures.set(parsed.feature, list);
    }
  }

  // Features that have left a state trail (todo / approval / report) but no
  // longer have a worktree → "merged" stage.
  const cleanedFeatures = new Set<string>();
  for (const r of readReports(project.name)) {
    if (!liveFeatures.has(r.feature)) cleanedFeatures.add(r.feature);
  }
  // We don't enumerate todo/approval state files separately — readReports +
  // worktree list is enough to surface the common cases. Adding orphan
  // states later is a one-line filesystem walk if it matters.

  const entries: PipelineEntry[] = [];
  for (const [feature, repos] of liveFeatures) {
    entries.push(buildEntry(project.name, feature, repos));
  }
  for (const feature of cleanedFeatures) {
    entries.push(buildEntry(project.name, feature, []));
  }

  // Stable sort: in-progress features first (lower stage index), then by
  // feature name.
  entries.sort((a, b) => {
    if (a.stageIndex !== b.stageIndex) return a.stageIndex - b.stageIndex;
    return a.feature.localeCompare(b.feature);
  });
  return entries;
}

function buildEntry(
  projectName: string,
  feature: string,
  repos: string[],
): PipelineEntry {
  const todo = getTodo(projectName, feature);
  const approval = getApproval(projectName, feature);
  const reports = readReports(projectName, { feature });
  const latestReport = reports.length > 0 ? reports[reports.length - 1] : undefined;

  const { stage, flag } = decideStage({ repos, todo, approval, latestReport });

  return {
    feature,
    repos,
    stage,
    stageIndex: STAGES.indexOf(stage),
    flag,
    ...(todo ? {
      todo: {
        total: todo.items.length,
        done: todo.items.filter((it) => it.done).length,
        updatedAt: todo.updatedAt,
      },
    } : {}),
    ...(approval ? {
      approval: {
        status: approvalStatus(approval),
        planSubmittedAt: approval.planSubmittedAt,
        approvedAt: approval.approvedAt,
        rejectionNote: approval.rejectionNote,
      },
    } : {}),
    ...(latestReport ? { latestReport } : {}),
  };
}

function decideStage(input: {
  repos: string[];
  todo: FeatureTodo | undefined;
  approval: ApprovalState | undefined;
  latestReport: FeatureReport | undefined;
}): { stage: PipelineStage; flag?: PipelineFlag } {
  const { repos, todo, approval, latestReport } = input;

  // No worktree on disk anymore → merged (or wt-rm'd; no signal
  // distinguishes the two from here).
  if (repos.length === 0) return { stage: "merged" };

  // Off-pipeline flags surface alongside the stage (red/yellow indicator
  // on the same row).
  let flag: PipelineFlag | undefined;
  if (latestReport?.status === "blocked") flag = "blocked";
  else if (latestReport?.status === "needs_review") flag = "needs_review";

  const aStatus = approvalStatus(approval);
  if (aStatus === "rejected") flag = flag ?? "rejected";

  // Stage decision, most-progressed wins:

  // 1. Reported — a "done" report exists and the todo is complete (or
  //    there isn't one).
  if (latestReport?.status === "done") {
    const todoComplete = !todo || todo.items.length === 0 || todo.items.every((it) => it.done);
    if (todoComplete) return { stage: "reported", flag };
  }

  // 2. Approval pending — agent has submitted a plan, awaiting user.
  if (aStatus === "pending") return { stage: "approval", flag };

  // 3. Rejected — agent is back to planning. This is the only case where
  //    "planning" is the actual stage; otherwise having a todo means
  //    you're already working.
  if (aStatus === "rejected") return { stage: "planning", flag };

  // 4. Working — has a todo with items, regardless of whether review-plan
  //    was activated. (The approval gate, when relevant, is handled by
  //    cases 2 and 3 above.)
  if (todo && todo.items.length > 0) return { stage: "working", flag };

  // 5. Default — worktree exists, nothing else recorded yet.
  return { stage: "created", flag };
}
