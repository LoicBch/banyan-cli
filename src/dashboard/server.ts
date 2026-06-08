/**
 * Dashboard HTTP server — bootstrap, lifecycle, route mounting.
 *
 * This file used to hold every endpoint inline (~930 LOC). After the
 * Phase 2 refactor it just wires the long-lived pieces together:
 *   1. Express app + JSON middleware + optional auth gate
 *   2. Integrations scheduler (poll loop for ClickUp / Linear / Jira)
 *   3. Discord RPC service (optional, falls back to null on init error)
 *   4. Route registration — each `routes/*.ts` module mounts its own
 *      endpoints, receiving exactly the deps it needs
 *   5. Static SPA mounts (legacy vanilla under /legacy, React build at /)
 *   6. Listen on first-free port (default 4242), wire close() teardown
 *
 * Adding a new endpoint = pick the right `routes/<category>.ts` file
 * (or create a new one + a `register()` call here). Never add an
 * `app.get`/`app.post` directly in this file.
 */
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import type { Config } from "../config.js";
import { authMiddleware, type AuthConfig } from "./auth.js";
import {
  loadIntegrationsConfig,
} from "../integrations/config.js";
import { IntegrationsScheduler } from "../integrations/scheduler.js";

import * as stateRoutes from "./routes/state.js";
import * as actionsRoutes from "./routes/actions.js";
import * as shortcutsRoutes from "./routes/shortcuts.js";
import * as configRoutes from "./routes/config.js";
import * as wizardRoutes from "./routes/wizard.js";
import * as askRoutes from "./routes/ask.js";
import * as historyRoutes from "./routes/history.js";
import * as mrRoutes from "./routes/mr.js";
import * as integrationsRoutes from "./routes/integrations.js";
import * as worktreeRoutes from "./routes/worktree.js";

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

  // ── Long-lived services ──────────────────────────────────────────────

  // Integrations scheduler — null-safe: an integrations.yaml error logs to
  // stderr and leaves the scheduler running with zero sources rather than
  // crashing the dashboard.
  const integrationsCfg = (() => {
    try { return loadIntegrationsConfig(); }
    catch (err) {
      console.error("[integrations] config error:", (err as Error).message);
      return { sources: [], rules: [] };
    }
  })();
  const scheduler = new IntegrationsScheduler(integrationsCfg);
  scheduler.start();

  // Discord RPC — optional. We hoist `buildDiscordActivity` here (not inside
  // the route module) because the boot-time `start()` call and the toggle
  // route both need the same factory.
  const buildDiscordActivity = async () => {
    const { readBanyanActivity } = await import("../integrations/discord-rpc/stateReader.js");
    const dashboardUrl = `http://localhost:${opts.port ?? 4242}`;
    return readBanyanActivity(config, dashboardUrl);
  };

  const discordRpc = await (async () => {
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

  // ── Route registration ───────────────────────────────────────────────
  // Each module mounts its own endpoints. Order doesn't matter for routing
  // since paths are distinct; we group by concern for readability.

  stateRoutes.register(app, { config, auth: opts.auth });
  actionsRoutes.register(app, { config });
  shortcutsRoutes.register(app);
  configRoutes.register(app, { filesystemRoutesEnabled: !opts.auth?.enabled });
  wizardRoutes.register(app, {
    config,
    filesystemRoutesEnabled: !opts.auth?.enabled,
  });
  askRoutes.register(app, { config });
  historyRoutes.register(app, { config });
  mrRoutes.register(app, { config });
  worktreeRoutes.register(app, { config });
  integrationsRoutes.register(app, {
    config,
    scheduler,
    discordRpc,
    buildDiscordActivity,
  });

  // ── Static SPA ───────────────────────────────────────────────────────
  // New React build at the root, legacy vanilla-JS dashboard preserved at
  // /legacy/ during the migration. Both share the same /api/* backend.
  app.use("/legacy", express.static(path.join(__dirname, "static")));
  app.use(express.static(path.join(__dirname, "web")));

  // ── Listen ───────────────────────────────────────────────────────────
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
        if (discordRpc) {
          await discordRpc.stop();
        }
        server.close(() => resolve());
      }),
  };
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
