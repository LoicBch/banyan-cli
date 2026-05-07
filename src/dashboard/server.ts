import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import type { Config } from "../config.js";
import { buildState } from "./state.js";
import {
  actionTestStart,
  actionTestStop,
  actionCleanup,
  actionEnvUp,
  actionEnvDown,
  actionEnvRecreate,
  actionMrStatus,
} from "./actions.js";
import { readReports } from "../reports.js";
import { listTodoFeatures } from "../todo.js";
import { buildPipeline } from "./pipeline.js";
import { approvalStatus, approvePlan, getApproval, rejectPlan } from "../approval.js";
import { readdirSync, existsSync as fsExists } from "node:fs";
import { homedir } from "node:os";

export interface ServerOptions {
  port?: number;         // default: first free port starting from 4242
  open?: boolean;        // open browser automatically on start
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Start the dashboard HTTP server. Resolves when the server is bound. */
export async function startServer(
  config: Config,
  opts: ServerOptions = {},
): Promise<{ port: number; url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  // JSON state endpoint — the SPA polls this.
  app.get("/api/state", async (_req, res) => {
    try {
      const state = await buildState(config);
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Liveness probe
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "banyan-dashboard" });
  });

  // Conflict-risk pulse — same data as `bn <project> pulse`, served as JSON.
  app.get(
    "/api/pulse/:project",
    async (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      const project = config.projects.find((p) => p.name === projectName);
      if (!project) {
        res.status(404).json({ error: `unknown project '${projectName}'` });
        return;
      }
      try {
        const { computePulse } = await import("../commands/pulse.js");
        const result = await computePulse(project);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  // Reports timeline — append-only end-of-task reports per project.
  app.get(
    "/api/reports/:project",
    async (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      if (!config.projects.some((p) => p.name === projectName)) {
        res.status(404).json({ error: `unknown project '${projectName}'` });
        return;
      }
      const q = req.query as Record<string, string | undefined>;
      try {
        const reports = readReports(projectName, {
          feature: q.feature || undefined,
          since: q.since || undefined,
          latestOnly: q.latestOnly === "true" || q.latestOnly === "1",
        });
        res.json({ reports });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  // Pipeline view per project — aggregates worktrees + todos + approvals +
  // reports into a per-feature lifecycle state. Powers the headline view in
  // the dashboard.
  app.get(
    "/api/pipeline/:project",
    async (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      const project = config.projects.find((p) => p.name === projectName);
      if (!project) {
        res.status(404).json({ error: `unknown project '${projectName}'` });
        return;
      }
      try {
        const features = await buildPipeline(project);
        res.json({ features });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  // Approval states per project (all features that have one).
  app.get(
    "/api/approvals/:project",
    (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      if (!config.projects.some((p) => p.name === projectName)) {
        res.status(404).json({ error: `unknown project '${projectName}'` });
        return;
      }
      const stateDir = `${homedir()}/.config/banyan/state`;
      if (!fsExists(stateDir)) {
        res.json({ approvals: [] });
        return;
      }
      const prefix = `${projectName}.`;
      const suffix = ".approval.json";
      const out: unknown[] = [];
      for (const f of readdirSync(stateDir)) {
        if (!f.startsWith(prefix) || !f.endsWith(suffix)) continue;
        const feature = f.slice(prefix.length, -suffix.length);
        const state = getApproval(projectName, feature);
        if (!state) continue;
        out.push({ ...state, status: approvalStatus(state) });
      }
      res.json({ approvals: out });
    },
  );

  app.post("/api/actions/approve", (req, res) => {
    if (!requireFields(req, res, ["project", "feature"])) return;
    const { project, feature, reject, note } = req.body as {
      project: string;
      feature: string;
      reject?: boolean;
      note?: string;
    };
    try {
      const state = reject
        ? rejectPlan(project, feature, note)
        : approvePlan(project, feature);
      res.json({ ok: true, state, status: approvalStatus(state) });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // TODO lists per project (all features).
  app.get(
    "/api/todos/:project",
    (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      if (!config.projects.some((p) => p.name === projectName)) {
        res.status(404).json({ error: `unknown project '${projectName}'` });
        return;
      }
      try {
        res.json({ todos: listTodoFeatures(projectName) });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  // ── Actions ─────────────────────────────────────────────────────────────
  // All mutating endpoints are POST. Body is JSON { project, feature, repo? }.

  app.post("/api/actions/test/start", async (req, res) => {
    if (!requireFields(req, res, ["project", "feature"])) return;
    const { project, feature, repos } = req.body as {
      project: string; feature: string; repos?: string[];
    };
    const r = await actionTestStart(config, { project, feature, repos });
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/actions/test/stop", async (req, res) => {
    if (!requireFields(req, res, ["project", "feature"])) return;
    const { project, feature } = req.body as { project: string; feature: string };
    const r = await actionTestStop(config, { project, feature });
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/actions/cleanup", async (req, res) => {
    if (!requireFields(req, res, ["project", "feature", "repo"])) return;
    const { project, feature, repo } = req.body as {
      project: string; feature: string; repo: string;
    };
    const r = await actionCleanup(config, { project, feature, repo });
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/actions/env/up", async (req, res) => {
    if (!requireFields(req, res, ["project", "feature"])) return;
    const { project, feature, repo } = req.body as {
      project: string; feature: string; repo?: string;
    };
    const r = await actionEnvUp(config, { project, feature, repo });
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/actions/env/down", async (req, res) => {
    if (!requireFields(req, res, ["project", "feature"])) return;
    const { project, feature, repo } = req.body as {
      project: string; feature: string; repo?: string;
    };
    const r = await actionEnvDown(config, { project, feature, repo });
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/actions/env/recreate", async (req, res) => {
    if (!requireFields(req, res, ["project", "feature"])) return;
    const { project, feature, repo } = req.body as {
      project: string; feature: string; repo?: string;
    };
    const r = await actionEnvRecreate(config, { project, feature, repo });
    res.status(r.ok ? 200 : 400).json(r);
  });

  // MR/PR status — GET, lazy per-worktree.
  app.get(
    "/api/mr/:project/:repo/:feature",
    async (req: Request<{ project: string; repo: string; feature: string }>, res: Response) => {
      const { project, repo, feature } = req.params;
      const r = await actionMrStatus(config, { project, repo, feature });
      res.status(r.ok ? 200 : 400).json(r);
    },
  );

  // Static SPA
  app.use(express.static(path.join(__dirname, "static")));

  const port = opts.port ?? (await findFreePort(4242));

  const server = app.listen(port);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  const url = `http://localhost:${port}`;

  if (opts.open) {
    const { spawn } = await import("node:child_process");
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
  }

  return {
    port,
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function requireFields(
  req: Request,
  res: Response,
  fields: string[],
): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const missing = fields.filter((f) => body[f] == null || body[f] === "");
  if (missing.length > 0) {
    res.status(400).json({ ok: false, error: `missing fields: ${missing.join(", ")}` });
    return false;
  }
  return true;
}

async function findFreePort(startFrom: number): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const p = startFrom + i;
    if (await isFree(p)) return p;
  }
  throw new Error("no free port for dashboard");
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => {
      s.close(() => resolve(true));
    });
    s.listen(port, "127.0.0.1");
  });
}
