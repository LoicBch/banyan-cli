/**
 * Client-side types + fetch helpers for the banyan dashboard API.
 *
 * These mirror what /api/state returns. Kept loose (a lot of optional fields)
 * because the backend may evolve faster than the React frontend.
 */

export interface Worktree {
  feature: string;
  branch: string;
  path: string;
  ahead?: number;
  behind?: number;
  dirty?: boolean;
}

export interface Stack {
  feature: string;
  running: boolean;
  hostPorts?: Array<{ service: string; port: number }>;
}

export interface RepoState {
  name: string;
  type: "git" | "compose";
  path: string;
  /** Tech profile id — `node`, `spring-boot`, `android`, `django`, `custom`. */
  tech?: string;
  baseBranch?: string;
  worktrees: Worktree[];
  stacks: Stack[];
}

/** Mirrors src/dashboard/pipeline.ts:PipelineEntry. The full lifecycle
 *  snapshot of a feature, with the data needed to render gate buttons
 *  and stage indicators. */
export interface FeatureState {
  /** Feature short name (e.g. "profile-page") */
  feature: string;
  /** Repos this feature has a worktree in. Empty when cleaned up. */
  repos?: string[];
  /** Pipeline lifecycle stage: created → planning → approval → working → reported → merged */
  stage?: "created" | "planning" | "approval" | "working" | "reported" | "merged" | string;
  /** 0..5 for progress fill. */
  stageIndex?: number;
  /** Off-pipeline attention flag (orthogonal to stage). */
  flag?: "rejected" | "blocked" | "needs_review";
  /** Agent autonomy mode if known. Accepts new (live/delegated) and legacy
   *  4-mode names (normalized server-side). */
  mode?: string;
  reposActive?: string[];
  panesCount?: number;
  ports?: Array<{ repo: string; port: number }>;
  todo?: { total: number; done: number; updatedAt: string };
  /** Legacy alias kept for backward compat with older state shape. */
  todos?: { done: number; total: number };
  approval?: {
    status: "none" | "pending" | "approved" | "rejected";
    planSubmittedAt: string | null;
    approvedAt: string | null;
    rejectionNote: string | null;
  };
  latestReport?: {
    feature: string;
    ts: string;
    status: "done" | "blocked" | "needs_review" | string;
    summary?: string;
    testInstructions?: string;
    hesitations?: string[];
    openQuestions?: string[];
    risks?: string[];
    filesChanged?: string[];
    commits?: Array<{ sha: string; message: string }>;
    approved?: boolean;
  };
  reportApproval?: {
    status: "none" | "pending" | "approved" | "rejected" | string;
    rejectionNote: string | null;
  };
}

export interface ProjectState {
  name: string;
  repos: RepoState[];
  /** Optional aggregated pipeline view (from /api/pipeline/:project). */
  features?: FeatureState[];
}

export interface DashboardState {
  generatedAt: number;
  projects: ProjectState[];
  /** True when the dashboard is running locally (no `--remote` tunnel).
   *  Some features (e.g. native terminal launch) only work in this mode. */
  localMode?: boolean;
  error?: string;
}

import { apiFetch } from "./auth";

export async function fetchState(): Promise<DashboardState> {
  const r = await apiFetch("/api/state");
  if (!r.ok) throw new Error(`/api/state ${r.status}`);
  return (await r.json()) as DashboardState;
}

export async function fetchPipeline(project: string): Promise<{ features: FeatureState[] }> {
  const r = await apiFetch(`/api/pipeline/${encodeURIComponent(project)}`);
  if (!r.ok) throw new Error(`/api/pipeline ${r.status}`);
  return (await r.json()) as { features: FeatureState[] };
}
