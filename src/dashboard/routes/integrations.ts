/**
 * Integration sources (ClickUp / Linear / Jira) + Discord Rich Presence
 * endpoints.
 *
 * The scheduler and Discord RPC service are long-lived per-server instances
 * created at boot time in `server.ts` — they're passed in here as deps so
 * routes can poll, toggle, and reload them without going through globals.
 *
 * `/api/integrations/spawn` lives here (not in worktree.ts) because it's
 * tied to the inbox lifecycle: spawn → markSpawned, archive logic, the
 * LLM-slug generation from task title+description. Generic worktree
 * creation lives in worktree.ts.
 */
import type { Express } from "express";
import type { Config } from "../../config.js";
import { wtAll } from "../../commands/wtAll.js";
import {
  loadIntegrationsConfig,
  saveIntegrationsConfig,
  integrationsConfigPath,
} from "../../integrations/config.js";
import type { IntegrationsScheduler } from "../../integrations/scheduler.js";
import { readInbox, markSpawned, markDismissed } from "../../integrations/inbox.js";
import { requireFields } from "./shared.js";

/** Loosely-typed Discord service surface — the concrete shape comes from
 *  `integrations/discord-rpc/index.ts` (dynamic-imported at boot). We type
 *  the methods we use here so the route file stays decoupled. */
export interface DiscordRpcServiceLike {
  isConnected(): boolean;
  updateConfig(patch: { enabled?: boolean }): void;
  start(buildActivity: () => Promise<unknown>): Promise<void>;
  stop(): Promise<void>;
}

export interface IntegrationsDeps {
  config: Config;
  scheduler: IntegrationsScheduler;
  /** Null if Discord initialisation failed at boot. */
  discordRpc: DiscordRpcServiceLike | null;
  buildDiscordActivity: () => Promise<unknown>;
}

export function register(app: Express, deps: IntegrationsDeps): void {
  const { config, scheduler, discordRpc, buildDiscordActivity } = deps;

  // ── Discord RPC ──────────────────────────────────────────────────────

  app.get("/api/discord/enabled", async (_req, res) => {
    const { loadDiscordRpcConfig } = await import("../../integrations/discord-rpc/configLoader.js");
    const cfg = loadDiscordRpcConfig();
    res.json({
      enabled: cfg.enabled,
      connected: discordRpc?.isConnected() ?? false,
    });
  });

  app.post("/api/discord/enabled", async (req, res) => {
    const { loadDiscordRpcConfig, saveDiscordRpcConfig } = await import("../../integrations/discord-rpc/configLoader.js");
    const body = (req.body ?? {}) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "missing 'enabled' boolean" });
      return;
    }
    const cfg = loadDiscordRpcConfig();
    cfg.enabled = body.enabled;
    saveDiscordRpcConfig(cfg);

    if (!discordRpc) {
      res.json({ ok: true, enabled: body.enabled, connected: false });
      return;
    }

    discordRpc.updateConfig({ enabled: body.enabled });
    try {
      if (body.enabled) {
        await discordRpc.start(buildDiscordActivity);
        console.log("[discord-rpc] Service started (toggle)");
      } else {
        await discordRpc.stop();
        console.log("[discord-rpc] Service stopped (toggle)");
      }
    } catch (err) {
      console.error("[discord-rpc] toggle failed:", (err as Error).message);
    }

    res.json({
      ok: true,
      enabled: body.enabled,
      connected: discordRpc.isConnected(),
    });
  });

  app.get("/api/discord/focus", async (_req, res) => {
    const { getDiscordFocus } = await import("../../integrations/discord-rpc/focus.js");
    res.json(getDiscordFocus());
  });

  app.post("/api/discord/focus", async (req, res) => {
    const { setDiscordFocus } = await import("../../integrations/discord-rpc/focus.js");
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

  // ── Inbox + sources config ──────────────────────────────────────────

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
  // agent's initial prompt and the task title as a hint for the feature
  // name (the LLM-slug step picks the real slug from the prompt).
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
      const { generateSlug } = await import("../../slug.js");
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

  app.get("/api/integrations/config", (_req, res) => {
    try {
      const cfg = loadIntegrationsConfig();
      res.json({ config: cfg, configPath: integrationsConfigPath() });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/integrations/config", async (req, res) => {
    const body = req.body as { config?: { sources?: unknown[]; rules?: unknown[] } };
    if (!body?.config || !Array.isArray(body.config.sources) || !Array.isArray(body.config.rules)) {
      res.status(400).json({ ok: false, error: "config must contain sources[] and rules[]" });
      return;
    }
    try {
      // Cast through `as never` to satisfy the typed loader's strict shape;
      // the loader re-validates properly when we reload.
      await saveIntegrationsConfig({
        sources: body.config.sources as never,
        rules: body.config.rules as never,
      });
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
}

/** Compose the initial prompt sent to an agent spawned from an inbox task.
 *  Includes the task title, link, and description so the agent has full
 *  context to start working immediately. */
function buildInitialPrompt(entry: {
  task: {
    title: string;
    url?: string;
    description?: string;
    status?: string;
    source: string;
  };
}): string {
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
