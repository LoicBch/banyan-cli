/**
 * Discord Rich Presence endpoints.
 *
 * The Discord RPC service is a long-lived per-server instance created at
 * boot time in `server.ts` — passed in here as a dep so routes can toggle
 * + focus it without going through globals.
 *
 * (Previously this file also hosted ClickUp inbox / spawn / sources-config
 * routes — those were removed when the task-ingestion feature was dropped.
 * Discord RPC is kept because it's an unrelated, self-contained
 * integration.)
 */
import type { Express } from "express";

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
  /** Null if Discord initialisation failed at boot. */
  discordRpc: DiscordRpcServiceLike | null;
  buildDiscordActivity: () => Promise<unknown>;
}

export function register(app: Express, deps: IntegrationsDeps): void {
  const { discordRpc, buildDiscordActivity } = deps;

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
}
