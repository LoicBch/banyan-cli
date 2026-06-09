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

export interface FeatureState {
  /** Feature short name (e.g. "profile-page") */
  feature: string;
  /** Stage in the pipeline lifecycle */
  stage?: "draft" | "in-progress" | "review" | "merged" | string;
  /** Agent autonomy mode if known */
  mode?: "interactive" | "assisted" | "autonomous" | "autopilot" | string;
  reposActive?: string[];
  panesCount?: number;
  ports?: Array<{ repo: string; port: number }>;
  todos?: { done: number; total: number };
  latestReport?: { ts: number; approved?: boolean };
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

export async function fetchState(): Promise<DashboardState> {
  const r = await fetch("/api/state");
  if (!r.ok) throw new Error(`/api/state ${r.status}`);
  return (await r.json()) as DashboardState;
}

export async function fetchPipeline(project: string): Promise<{ features: FeatureState[] }> {
  const r = await fetch(`/api/pipeline/${encodeURIComponent(project)}`);
  if (!r.ok) throw new Error(`/api/pipeline ${r.status}`);
  return (await r.json()) as { features: FeatureState[] };
}
