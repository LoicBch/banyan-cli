/**
 * Read-only state endpoints: auth status, full dashboard state, health
 * probe, conflict pulse, reports timeline, pipeline view, plan-approval
 * state per project, todo lists per project.
 *
 * No mutation here — these are the routes the SPA polls every 2s plus
 * occasional one-off reads. Mutating actions live in `actions.ts`.
 */
import type { Express, Request, Response } from "express";
import { readdirSync, existsSync as fsExists } from "node:fs";
import { homedir } from "node:os";
import { buildState } from "../state.js";
import { readReports } from "../../reports.js";
import { listTodoFeatures } from "../../todo.js";
import { buildPipeline } from "../pipeline.js";
import { approvalStatus, getApproval } from "../../approval.js";
import type { AuthConfig } from "../auth.js";
import { rejectUnknownProject, type RouteDeps } from "./shared.js";

interface StateDeps extends RouteDeps {
  /** Auth config — exposed to the SPA so it can show a banner / disable
   *  inputs when no token is present. The state route is the right home
   *  for this since the SPA polls it as part of bootstrap. */
  auth?: AuthConfig;
}

export function register(app: Express, deps: StateDeps): void {
  const { config, auth } = deps;

  // Auth status — always public regardless of middleware setup.
  app.get("/api/auth-status", (_req: Request, res: Response) => {
    res.json({ authRequired: !!auth?.enabled });
  });

  // Full SPA state — the polling target.
  app.get("/api/state", async (_req, res) => {
    try {
      const state = await buildState(config);
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Liveness probe.
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
        const { computePulse } = await import("../pulse.js");
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
      if (rejectUnknownProject(config, projectName, res)) return;
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
      if (rejectUnknownProject(config, projectName, res)) return;
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

  // TODO lists per project (all features).
  app.get(
    "/api/todos/:project",
    (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      if (rejectUnknownProject(config, projectName, res)) return;
      try {
        res.json({ todos: listTodoFeatures(projectName) });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );
}
