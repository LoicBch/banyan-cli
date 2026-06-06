import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import type { Config } from "../config.js";
import { loadConfig } from "../config.js";
import { buildState } from "./state.js";
import {
  actionTestStart,
  actionTestStop,
  actionCleanup,
  actionEnvUp,
  actionEnvDown,
  actionEnvRecreate,
  actionMrStatus,
  actionMerge,
  actionRebase,
} from "./actions.js";
import { readReports } from "../reports.js";
import { listTodoFeatures } from "../todo.js";
import { buildPipeline } from "./pipeline.js";
import { approvalStatus, approvePlan, getApproval, rejectPlan } from "../approval.js";
import { approveReport, rejectReport, reportApprovalStatus } from "../reportApproval.js";
import {
  ACTIONS as SHORTCUT_ACTIONS,
  readBindings,
  writeBindings,
  defaultBindings,
} from "./shortcuts.js";
import { updateRepoRun, readConfigForDashboard } from "./configWrite.js";
import {
  listFsEntries,
  probePath,
  createProject,
  listTechProfiles,
  type CreateProjectInput,
} from "./wizard.js";
import { ask as askEngine, readAskHistory } from "../ask/index.js";
import { readHistoryEvents } from "../history.js";
import { authMiddleware, type AuthConfig } from "./auth.js";
import { wtAll } from "../commands/wtAll.js";
import {
  loadIntegrationsConfig,
  saveIntegrationsConfig,
  integrationsConfigPath,
} from "../integrations/config.js";
import { IntegrationsScheduler } from "../integrations/scheduler.js";
import { readInbox, markSpawned, markDismissed } from "../integrations/inbox.js";
import { readdirSync, existsSync as fsExists } from "node:fs";
import { homedir } from "node:os";

export interface ServerOptions {
  port?: number;         // default: first free port starting from 4242
  open?: boolean;        // open browser automatically on start
  /** When set, gates every API route with token auth. Required before binding
   *  the server to a public tunnel. */
  auth?: AuthConfig;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Start the dashboard HTTP server. Resolves when the server is bound. */
export async function startServer(
  config: Config,
  opts: ServerOptions = {},
): Promise<{ port: number; url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  // Auth — disabled by default (localhost dev). When `opts.auth.enabled`, every
  // request beyond the SPA shell needs a Bearer token (see auth.ts).
  if (opts.auth?.enabled) {
    app.use(authMiddleware(opts.auth));
  }

  // Expose auth status to the SPA so it can show a banner / disable inputs
  // when no token is present locally. Always-public regardless of auth.
  app.get("/api/auth-status", (_req: Request, res: Response) => {
    res.json({ authRequired: !!opts.auth?.enabled });
  });

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
        const { computePulse } = await import("./pulse.js");
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

  // Shortcuts config — read current bindings + their metadata, or save new ones.
  app.get("/api/shortcuts", (_req, res) => {
    try {
      const { bindings, configPath, tmuxConfPath } = readBindings();
      res.json({
        actions: SHORTCUT_ACTIONS,
        bindings,
        defaults: defaultBindings(),
        configPath,
        tmuxConfPath,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/shortcuts", async (req, res) => {
    const body = (req.body ?? {}) as { bindings?: Record<string, string> };
    if (!body.bindings || typeof body.bindings !== "object") {
      res.status(400).json({ ok: false, error: "missing bindings" });
      return;
    }
    try {
      const r = await writeBindings(body.bindings);
      res.status(r.ok ? 200 : 400).json(r);
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // Repo run-config (for the Config tab). Returns just what the editor needs.
  app.get("/api/config/repos", async (_req, res) => {
    try {
      const fresh = await readConfigForDashboard();
      const projects = fresh.projects.map((p) => ({
        name: p.name,
        repos: p.repos.map((r) => ({
          name: r.name,
          type: r.type ?? "git",
          path: r.path,
          run: r.run ?? null,
          deployCommand: r.deployCommand ?? null,
        })),
      }));
      res.json({ projects });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/config/repos/run", async (req, res) => {
    if (!requireFields(req, res, ["project", "repo", "run"])) return;
    const { project, repo, run } = req.body as {
      project: string;
      repo: string;
      run: {
        command: string;
        setup?: string;
        stopCommand?: string;
        presets?: Record<string, string>;
        activePreset?: string;
      };
    };
    try {
      if (!run || typeof run.command !== "string" || run.command === "") {
        res.status(400).json({ ok: false, error: "run.command is required" });
        return;
      }
      await updateRepoRun(project, repo, run);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // ── Create-project wizard ────────────────────────────────────────────────
  // These three endpoints power the dashboard's "New project" flow. The fs
  // browser and probe are filesystem-introspection routes — when the dashboard
  // is exposed via a public tunnel (--remote), we refuse them outright so an
  // attacker who guesses the bearer token can't enumerate $HOME.
  const filesystemRoutesEnabled = !opts.auth?.enabled;

  app.get("/api/tech-profiles", (_req, res) => {
    res.json({ profiles: listTechProfiles() });
  });

  app.get("/api/fs/list", (req, res) => {
    if (!filesystemRoutesEnabled) {
      res.status(403).json({ ok: false, error: "filesystem browser is disabled in remote mode" });
      return;
    }
    const dir = typeof req.query.path === "string" && req.query.path.length > 0
      ? req.query.path
      : homedir();
    try {
      res.json(listFsEntries(dir));
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/api/fs/probe", (req, res) => {
    if (!filesystemRoutesEnabled) {
      res.status(403).json({ ok: false, error: "filesystem probe is disabled in remote mode" });
      return;
    }
    const body = (req.body ?? {}) as { path?: string };
    if (!body.path || typeof body.path !== "string") {
      res.status(400).json({ ok: false, error: "path is required" });
      return;
    }
    try {
      res.json(probePath(body.path));
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/api/projects", async (req, res) => {
    if (!filesystemRoutesEnabled) {
      res.status(403).json({ ok: false, error: "project creation is disabled in remote mode" });
      return;
    }
    const body = (req.body ?? {}) as Partial<CreateProjectInput>;
    if (!body.name || !Array.isArray(body.repos)) {
      res.status(400).json({ ok: false, error: "name and repos are required" });
      return;
    }
    try {
      await createProject(body as CreateProjectInput);
      // Reload the in-memory config so /api/state surfaces the new project
      // immediately, without needing a server restart.
      const fresh = await loadConfig();
      config.projects.length = 0;
      config.projects.push(...fresh.projects);
      res.json({ ok: true, name: body.name });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // bn ask — chat-style endpoint. Streams Claude's answer via SSE.
  app.post(
    "/api/ask/:project",
    async (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      if (!config.projects.some((p) => p.name === projectName)) {
        res.status(404).json({ error: `unknown project '${projectName}'` });
        return;
      }
      const body = (req.body ?? {}) as {
        question?: string;
        feature?: string;
        days?: number;
        includeTranscripts?: boolean;
        model?: string;
      };
      const question = (body.question ?? "").trim();
      if (!question) {
        res.status(400).json({ ok: false, error: "question is required" });
        return;
      }
      // SSE setup
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const askOpts = {
          ...(body.feature ? { feature: body.feature } : {}),
          ...(body.days !== undefined ? { daysOfCommits: body.days } : {}),
          ...(body.includeTranscripts === false ? { includeTranscripts: false } : {}),
          ...(body.model ? { model: body.model } : {}),
        };
        const record = await askEngine(config, projectName, question, askOpts, (chunk) => {
          send("chunk", { text: chunk });
        });
        send("done", { record });
        res.end();
      } catch (err) {
        send("error", { message: (err as Error).message });
        res.end();
      }
    },
  );

  // ── integrations / inbox ──────────────────────────────────────────────
  // Built once at server start. Disabled (sourceCount === 0) when the user
  // has no integrations.yaml.
  const integrationsCfg = (() => {
    try { return loadIntegrationsConfig(); }
    catch (err) {
      console.error("[integrations] config error:", (err as Error).message);
      return { sources: [], rules: [] };
    }
  })();
  const scheduler = new IntegrationsScheduler(integrationsCfg);
  scheduler.start();

  // ── Discord Rich Presence ──────────────────────────────────────────────
  // Optional integration - displays Banyan activity in Discord profile.
  // Completely separated from core Banyan logic.
  // Hoisted so the /api/discord/enabled endpoint can re-trigger a start
  // after the user flips the toggle without restarting the dashboard.
  const buildDiscordActivity = async () => {
    const { readBanyanActivity } = await import("../integrations/discord-rpc/stateReader.js");
    const dashboardUrl = `http://localhost:${opts.port ?? 4242}`;
    return readBanyanActivity(config, dashboardUrl);
  };

  const discordRpcService = await (async () => {
    try {
      const { DiscordRpcService } = await import("../integrations/discord-rpc/index.js");
      const { loadDiscordRpcConfig } = await import("../integrations/discord-rpc/configLoader.js");

      const rpcConfig = loadDiscordRpcConfig();
      const service = DiscordRpcService.getInstance(rpcConfig);

      if (rpcConfig.enabled) {
        await service.start(buildDiscordActivity);
        console.log("[discord-rpc] Service started");
      }

      return service;
    } catch (err) {
      console.error("[discord-rpc] Failed to initialize:", (err as Error).message);
      return null;
    }
  })();

  app.get("/api/discord/enabled", async (_req, res) => {
    const { loadDiscordRpcConfig } = await import("../integrations/discord-rpc/configLoader.js");
    const cfg = loadDiscordRpcConfig();
    res.json({
      enabled: cfg.enabled,
      connected: discordRpcService?.isConnected() ?? false,
    });
  });

  app.post("/api/discord/enabled", async (req, res) => {
    const { loadDiscordRpcConfig, saveDiscordRpcConfig } = await import("../integrations/discord-rpc/configLoader.js");
    const body = (req.body ?? {}) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "missing 'enabled' boolean" });
      return;
    }
    const cfg = loadDiscordRpcConfig();
    cfg.enabled = body.enabled;
    saveDiscordRpcConfig(cfg);

    if (!discordRpcService) {
      res.json({ ok: true, enabled: body.enabled, connected: false });
      return;
    }

    discordRpcService.updateConfig({ enabled: body.enabled });
    try {
      if (body.enabled) {
        await discordRpcService.start(buildDiscordActivity);
        console.log("[discord-rpc] Service started (toggle)");
      } else {
        await discordRpcService.stop();
        console.log("[discord-rpc] Service stopped (toggle)");
      }
    } catch (err) {
      console.error("[discord-rpc] toggle failed:", (err as Error).message);
    }

    res.json({
      ok: true,
      enabled: body.enabled,
      connected: discordRpcService.isConnected(),
    });
  });

  app.get("/api/discord/focus", async (_req, res) => {
    const { getDiscordFocus } = await import("../integrations/discord-rpc/focus.js");
    res.json(getDiscordFocus());
  });

  app.post("/api/discord/focus", async (req, res) => {
    const { setDiscordFocus } = await import("../integrations/discord-rpc/focus.js");
    const body = (req.body ?? {}) as { project?: string | null; mode?: string };
    const patch: { project?: string | null; mode?: "follow" | "aggregate" } = {};
    if ("project" in body) {
      patch.project = typeof body.project === "string" && body.project.length > 0
        ? body.project
        : null;
    }
    if (body.mode === "follow" || body.mode === "aggregate") {
      patch.mode = body.mode;
    }
    const next = setDiscordFocus(patch);
    res.json({ ok: true, ...next });
  });

  app.get("/api/integrations/inbox", (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json({
      configured: scheduler.sourceCount,
      entries: readInbox({
        includeArchived: q.includeArchived === "1" || q.includeArchived === "true",
        ...(q.source ? { source: q.source } : {}),
        ...(q.limit ? { limit: parseInt(q.limit, 10) } : {}),
      }),
    });
  });

  app.post("/api/integrations/poll", async (_req, res) => {
    try {
      const r = await scheduler.runOnce();
      res.json({ ok: true, ...r });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // Spawn a worktree from an inbox task. Uses the task's description as the
  // agent's initial prompt and the task title as a hint for the feature name
  // (the draft worktree finalize step picks the real slug from the prompt).
  app.post("/api/integrations/spawn", async (req, res) => {
    if (!requireFields(req, res, ["taskId", "project"])) return;
    const body = (req.body ?? {}) as {
      taskId: string;
      project: string;
      mode?: "interactive" | "assisted" | "autonomous" | "autopilot";
      repos?: string[];
    };
    if (!config.projects.some((p) => p.name === body.project)) {
      res.status(404).json({ ok: false, error: `unknown project '${body.project}'` });
      return;
    }
    const entry = readInbox({ includeArchived: true, limit: 500 })
      .find((e) => e.task.id === body.taskId);
    if (!entry) {
      res.status(404).json({ ok: false, error: `unknown task '${body.taskId}'` });
      return;
    }
    try {
      const prompt = buildInitialPrompt(entry);
      // Compute the slug from the task description so the worktree, the
      // docker compose project name, and the tmux pane all get the right
      // name from the start — no draft → finalize dance.
      const { generateSlug } = await import("../slug.js");
      const featureName = await generateSlug(`${entry.task.title}\n\n${entry.task.description ?? ""}`);
      await wtAll(config, body.project, featureName, {
        ...(body.repos && body.repos.length > 0 ? { only: body.repos } : {}),
        initialPrompt: prompt,
        mode: body.mode ?? (entry.suggestedMode as "autonomous" | undefined) ?? "autonomous",
      });
      markSpawned(body.taskId, body.project, featureName);
      res.json({ ok: true, feature: featureName });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // Read the current integrations config (sources + rules) for the editor.
  app.get("/api/integrations/config", (_req, res) => {
    try {
      const cfg = loadIntegrationsConfig();
      res.json({ config: cfg, configPath: integrationsConfigPath() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Save edited integrations config and reload the running scheduler so
  // changes apply without a server restart.
  app.post("/api/integrations/config", async (req, res) => {
    const body = req.body as { config?: { sources?: unknown[]; rules?: unknown[] } };
    if (!body?.config || !Array.isArray(body.config.sources) || !Array.isArray(body.config.rules)) {
      res.status(400).json({ ok: false, error: "config must contain sources[] and rules[]" });
      return;
    }
    try {
      // Cast through any to satisfy the typed loader's strict shape; the
      // loader will validate properly when we reload.
      await saveIntegrationsConfig({
        sources: body.config.sources as never,
        rules: body.config.rules as never,
      });
      // Reload from disk to validate + apply to the running scheduler.
      const fresh = loadIntegrationsConfig();
      scheduler.reload(fresh);
      res.json({ ok: true, sourceCount: scheduler.sourceCount });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/api/integrations/dismiss", (req, res) => {
    if (!requireFields(req, res, ["taskId"])) return;
    const { taskId, note } = req.body as { taskId: string; note?: string };
    if (!markDismissed(taskId, note)) {
      res.status(404).json({ ok: false, error: `unknown task '${taskId}'` });
      return;
    }
    res.json({ ok: true });
  });

  // Spawn a new worktree from the dashboard (mobile-friendly: omit `feature`
  // to create a draft worktree — the agent picks the name from the first
  // prompt via banyan_finalize_feature_name).
  app.post("/api/wt", async (req, res) => {
    if (!requireFields(req, res, ["project"])) return;
    const body = (req.body ?? {}) as {
      project: string;
      feature?: string;
      repos?: string[];
      initialPrompt?: string;
      mode?: "interactive" | "assisted" | "autonomous" | "autopilot";
      prefix?: string;
      requireApproval?: boolean;
    };
    if (!config.projects.some((p) => p.name === body.project)) {
      res.status(404).json({ ok: false, error: `unknown project '${body.project}'` });
      return;
    }
    try {
      let featureName = body.feature?.trim();
      let inferredFromPrompt = false;
      if (!featureName) {
        // No explicit name → if a prompt is provided, infer the slug from it.
        // If nothing is provided either, fall back to a draft slug.
        if (body.initialPrompt && body.initialPrompt.trim().length > 0) {
          const { generateSlug } = await import("../slug.js");
          featureName = await generateSlug(body.initialPrompt);
          inferredFromPrompt = true;
        } else {
          const { generateDraftFeature } = await import("../naming.js");
          featureName = generateDraftFeature();
        }
      }
      await wtAll(config, body.project, featureName, {
        ...(body.repos && body.repos.length > 0 ? { only: body.repos } : {}),
        ...(body.initialPrompt ? { initialPrompt: body.initialPrompt } : {}),
        ...(body.prefix !== undefined ? { prefix: body.prefix } : {}),
        ...(body.mode ? { mode: body.mode } : {}),
        ...(body.requireApproval ? { requireApproval: true } : {}),
      });
      res.json({
        ok: true,
        feature: featureName,
        draft: !body.feature && !inferredFromPrompt,
        inferredFromPrompt,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // Recorded history events (merges/cleanups/rebases) per project.
  app.get(
    "/api/history/:project",
    (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      if (!config.projects.some((p) => p.name === projectName)) {
        res.status(404).json({ error: `unknown project '${projectName}'` });
        return;
      }
      try {
        const q = req.query as Record<string, string | undefined>;
        const events = readHistoryEvents(projectName, {
          ...(q.feature ? { feature: q.feature } : {}),
          ...(q.kind ? { kind: q.kind as "merge" | "cleanup" | "rebase" } : {}),
          ...(q.since ? { since: q.since } : {}),
          ...(q.limit ? { limit: parseInt(q.limit, 10) } : {}),
        });
        res.json({ events });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  // Past Q&A for the project (newest first, capped).
  app.get(
    "/api/ask/:project/history",
    (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      if (!config.projects.some((p) => p.name === projectName)) {
        res.status(404).json({ error: `unknown project '${projectName}'` });
        return;
      }
      try {
        const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;
        res.json({ records: readAskHistory(projectName, limit) });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  // MR/PR status — GET, lazy per-worktree.
  app.get(
    "/api/mr/:project/:repo/:feature",
    async (req: Request<{ project: string; repo: string; feature: string }>, res: Response) => {
      const { project, repo, feature } = req.params;
      const r = await actionMrStatus(config, { project, repo, feature });
      res.status(r.ok ? 200 : 400).json(r);
    },
  );

  // Static SPA — the new React build is served at the root path, the legacy
  // vanilla-JS dashboard remains accessible at /legacy/ during the migration.
  // Both share the same /api/* backend.
  app.use("/legacy", express.static(path.join(__dirname, "static")));
  app.use(express.static(path.join(__dirname, "web")));

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
      new Promise<void>(async (resolve) => {
        scheduler.stop();
        if (discordRpcService) {
          await discordRpcService.stop();
        }
        server.close(() => resolve());
      }),
  };
}

/** Compose the initial prompt sent to an agent spawned from an inbox task.
 *  Includes the task title, link, and description so the agent has full
 *  context to (a) pick a feature slug via banyan_finalize_feature_name and
 *  (b) start working immediately. */
function buildInitialPrompt(entry: { task: { title: string; url?: string; description?: string; status?: string; source: string } }): string {
  const t = entry.task;
  const parts: string[] = [];
  parts.push(`Task from ${t.source}: ${t.title}`);
  if (t.url) parts.push(`Link: ${t.url}`);
  if (t.status) parts.push(`Status: ${t.status}`);
  if (t.description && t.description.trim().length > 0) {
    parts.push("");
    parts.push("Description:");
    parts.push(t.description.trim());
  } else {
    parts.push("");
    parts.push("(no description on the task — ask the user for clarification if needed before working.)");
  }
  return parts.join("\n");
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
