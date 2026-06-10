/**
 * Thin wrappers around /api/actions/* endpoints.
 *
 * Each action returns the server's JSON envelope as-is. UI components call
 * these from button click handlers, then surface success/failure via toast.
 */
import { apiFetch } from "./auth";

export interface ActionResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function post(path: string, body: unknown): Promise<ActionResult> {
  try {
    const r = await apiFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await r.json().catch(() => ({}))) as ActionResult;
    if (!r.ok && !("error" in data)) data.error = `${r.status}`;
    return data;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const testStart = (project: string, feature: string, repos?: string[]) =>
  post("/api/actions/test/start", { project, feature, ...(repos ? { repos } : {}) });

export const testStop = (project: string, feature: string) =>
  post("/api/actions/test/stop", { project, feature });

export const cleanup = (project: string, feature: string, opts: { repo?: string; force?: boolean } = {}) =>
  post("/api/actions/cleanup", { project, feature, ...opts });

export const merge = (project: string, feature: string, opts: { repo?: string } = {}) =>
  post("/api/actions/merge", { project, feature, ...opts });

export const rebase = (project: string, feature: string, opts: { repo?: string; base?: string } = {}) =>
  post("/api/actions/rebase", { project, feature, ...opts });

export const envUp = (project: string, feature: string, repo?: string) =>
  post("/api/actions/env/up", { project, feature, ...(repo ? { repo } : {}) });

export const envDown = (project: string, feature: string, repo?: string) =>
  post("/api/actions/env/down", { project, feature, ...(repo ? { repo } : {}) });

export const approve = (project: string, feature: string, scope: "plan" | "report", opts: { reject?: boolean; note?: string } = {}) =>
  post("/api/actions/approve", { project, feature, scope, ...opts });

/** Send a follow-up prompt to a feature's running agent — paste-and-submits
 *  the text into its tmux pane via `assignTask`. The agent receives it as a
 *  new turn and reacts (continues work, asks clarifying question, etc.).
 *  Used by the "Send message" feature-card button. */
export const sendTask = (project: string, feature: string, prompt: string, opts: { force?: boolean } = {}) =>
  post("/api/actions/task", { project, feature, prompt, ...opts });

/** Send a follow-up prompt to the project's orchestrator pane. With
 *  `delegate=true`, the prompt is wrapped with a directive that forces
 *  the orchestrator into strict coordinator mode (decompose into
 *  sub-features, no inline code work this turn). Used by the dashboard's
 *  "Talk to orchestrator" chat box at the top of the Pipeline view. */
export const sendOrchestratorTask = (
  project: string,
  prompt: string,
  opts: { delegate?: boolean; force?: boolean } = {},
) => post("/api/actions/orchestrator-task", { project, prompt, ...opts });

export const createWorktree = (body: {
  project: string;
  feature?: string;
  initialPrompt?: string;
  mode?: string;
  repos?: string[];
  /** When true (and in local mode) the backend pops a native terminal
   *  window already attached to the tmux session via osascript /
   *  gnome-terminal / wt.exe. Silently ignored in `--remote` mode. */
  openTerminal?: boolean;
}) => post("/api/wt", body);

/** Open a native terminal window attached to a project's tmux session.
 *  Local-mode only — fails with 403 when the dashboard is behind the
 *  `--remote` tunnel. */
export const openTerminal = (project: string) =>
  post("/api/terminal/open", { project });
