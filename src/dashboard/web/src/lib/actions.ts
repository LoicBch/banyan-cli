/**
 * Thin wrappers around /api/actions/* endpoints.
 *
 * Each action returns the server's JSON envelope as-is. UI components call
 * these from button click handlers, then surface success/failure via toast.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function post(path: string, body: unknown): Promise<ActionResult> {
  try {
    const r = await fetch(path, {
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

export const createWorktree = (body: {
  project: string;
  feature?: string;
  initialPrompt?: string;
  mode?: string;
  repos?: string[];
}) => post("/api/wt", body);
