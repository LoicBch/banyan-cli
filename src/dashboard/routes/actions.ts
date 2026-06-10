/**
 * Mutating action endpoints — POST /api/actions/* — that drive the
 * dashboard's buttons (start, stop, cleanup, merge, rebase, env up/down/
 * recreate, approve/reject plan or report).
 *
 * Each delegate calls a function from `../actions.ts` which wraps the
 * matching CLI command. The route layer only validates body shape and
 * forwards the result envelope back to the caller.
 */
import type { Express } from "express";
import {
  actionTestStart,
  actionTestStop,
  actionCleanup,
  actionEnvUp,
  actionEnvDown,
  actionEnvRecreate,
  actionMerge,
  actionRebase,
} from "../actions.js";
import { approvalStatus, approvePlan, rejectPlan } from "../../approval.js";
import { approveReport, rejectReport, reportApprovalStatus } from "../../reportApproval.js";
import { assignTask } from "../../commands/assignTask.js";
import { assignOrchestratorTask } from "../../commands/assignOrchestratorTask.js";
import { requireFields, type RouteDeps } from "./shared.js";

export function register(app: Express, deps: RouteDeps): void {
  const { config } = deps;

  app.post("/api/actions/approve", (req, res) => {
    if (!requireFields(req, res, ["project", "feature", "scope"])) return;
    const { project, feature, scope, reject, note } = req.body as {
      project: string;
      feature: string;
      scope: "plan" | "report";
      reject?: boolean;
      note?: string;
    };
    try {
      if (scope === "plan") {
        const state = reject
          ? rejectPlan(project, feature, note)
          : approvePlan(project, feature);
        res.json({ ok: true, state, status: approvalStatus(state) });
      } else if (scope === "report") {
        const r = reportApprovalStatus(project, feature);
        if (!r.latestReportTs) {
          res.status(400).json({ ok: false, error: "no report to decide on" });
          return;
        }
        const state = reject
          ? rejectReport(project, feature, r.latestReportTs, note)
          : approveReport(project, feature, r.latestReportTs);
        res.json({ ok: true, state });
      } else {
        res.status(400).json({ ok: false, error: `unknown scope '${scope}'` });
      }
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

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
    if (!requireFields(req, res, ["project", "feature"])) return;
    const { project, feature, repo, force } = req.body as {
      project: string; feature: string; repo?: string; force?: boolean;
    };
    const r = await actionCleanup(config, {
      project,
      feature,
      ...(repo ? { repo } : {}),
      ...(force ? { force: true } : {}),
    });
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/actions/merge", async (req, res) => {
    if (!requireFields(req, res, ["project", "feature"])) return;
    const { project, feature, repo, local, draft, wait, noResolve } = req.body as {
      project: string; feature: string; repo?: string;
      local?: boolean; draft?: boolean; wait?: boolean; noResolve?: boolean;
    };
    const r = await actionMerge(config, {
      project,
      feature,
      ...(repo ? { repo } : {}),
      ...(local ? { local: true } : {}),
      ...(draft ? { draft: true } : {}),
      ...(wait ? { wait: true } : {}),
      ...(noResolve ? { noResolve: true } : {}),
    });
    res.status(r.ok ? 200 : 400).json(r);
  });

  app.post("/api/actions/rebase", async (req, res) => {
    if (!requireFields(req, res, ["project", "feature"])) return;
    const { project, feature, repo, base } = req.body as {
      project: string; feature: string; repo?: string; base?: string;
    };
    const r = await actionRebase(config, {
      project,
      feature,
      ...(repo ? { repo } : {}),
      ...(base ? { base } : {}),
    });
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

  // Send a follow-up prompt to the project's ORCHESTRATOR pane. With
  // `delegate=true`, the prompt is wrapped with a directive that forces
  // strict-coordinator behaviour (decompose + spawn sub-features, no
  // inline code work). Used by the dashboard's "Talk to orchestrator"
  // chat box.
  app.post("/api/actions/orchestrator-task", async (req, res) => {
    if (!requireFields(req, res, ["project", "prompt"])) return;
    const { project, prompt, delegate, force } = req.body as {
      project: string;
      prompt: string;
      delegate?: boolean;
      force?: boolean;
    };
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      res.status(400).json({ ok: false, error: "prompt cannot be empty" });
      return;
    }
    try {
      const { paneId } = await assignOrchestratorTask(config, project, prompt, {
        ...(delegate ? { delegate: true } : {}),
        ...(force ? { force: true } : {}),
      });
      res.json({ ok: true, paneId });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // Send a follow-up prompt to an already-running feature agent. The
  // backend pastes the message into the agent's tmux pane via
  // `assignTask`. Used by the dashboard's "Send message" button to
  // intervene live in a delegated pipeline without leaving the browser.
  app.post("/api/actions/task", async (req, res) => {
    if (!requireFields(req, res, ["project", "feature", "prompt"])) return;
    const { project, feature, prompt, force } = req.body as {
      project: string;
      feature: string;
      prompt: string;
      force?: boolean;
    };
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      res.status(400).json({ ok: false, error: "prompt cannot be empty" });
      return;
    }
    try {
      const { paneId } = await assignTask(config, project, feature, prompt, {
        ...(force ? { force: true } : {}),
      });
      res.json({ ok: true, paneId });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });
}
