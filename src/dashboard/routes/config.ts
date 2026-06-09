/**
 * Repo run-config editor — what the dashboard's Config tab reads and writes.
 *
 * Reads come from `readConfigForDashboard` which always pulls from disk so
 * the editor reflects what's saved (not the in-memory copy that
 * `/api/projects` mutates). Writes go through `updateRepoRun` /
 * `updateRepoMeta` which preserve comments via `YAML.parseDocument`.
 *
 * The open-in-editor endpoint is gated to local mode (no auth) like the
 * filesystem routes — we don't want a remote attacker triggering shell
 * commands by guessing the token.
 */
import type { Express } from "express";
import { spawn } from "node:child_process";
import { defaultConfigPath, loadConfig, type Config } from "../../config.js";
import {
  updateRepoRun,
  updateRepoMeta,
  readConfigForDashboard,
} from "../configWrite.js";
import { requireFields } from "./shared.js";

interface ConfigDeps {
  /** Live config used by `/api/state` and other routes. We reload it
   *  after every mutation so the sidebar / pipeline reflect the change
   *  without waiting for a server restart. */
  config: Config;
  /** True in local mode — gates routes that touch the user's machine
   *  beyond config-file mutation (specifically: opening the YAML in
   *  their editor). */
  filesystemRoutesEnabled: boolean;
}

export function register(app: Express, deps: ConfigDeps): void {
  const { config, filesystemRoutesEnabled } = deps;

  // Reload the live in-memory config from disk. Called after every
  // mutation so `/api/state` (which reads from the passed-in object)
  // sees the new values without a server restart.
  async function reloadInMemoryConfig(): Promise<void> {
    const fresh = await loadConfig();
    config.projects.length = 0;
    config.projects.push(...fresh.projects);
  }

  app.get("/api/config/repos", async (_req, res) => {
    try {
      const fresh = await readConfigForDashboard();
      const projects = fresh.projects.map((p) => ({
        name: p.name,
        repos: p.repos.map((r) => ({
          name: r.name,
          type: r.type ?? "git",
          path: r.path,
          tech: r.tech ?? null,
          baseBranch: r.baseBranch ?? null,
          run: r.run ?? null,
        })),
      }));
      res.json({
        projects,
        configPath: defaultConfigPath(),
      });
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
      await reloadInMemoryConfig();
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // Meta fields (tech, baseBranch) — separate from `run` so a save can
  // touch either without rewriting the whole block.
  app.post("/api/config/repos/meta", async (req, res) => {
    if (!requireFields(req, res, ["project", "repo"])) return;
    const { project, repo, tech, baseBranch } = req.body as {
      project: string;
      repo: string;
      tech?: string;
      baseBranch?: string;
    };
    try {
      await updateRepoMeta(project, repo, { tech, baseBranch });
      await reloadInMemoryConfig();
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // Open the config file in the user's default editor. Local-only — we
  // don't want a tunneled dashboard triggering OS-level commands.
  app.post("/api/config/open", (_req, res) => {
    if (!filesystemRoutesEnabled) {
      res.status(403).json({ ok: false, error: "open-in-editor is disabled in remote mode" });
      return;
    }
    const target = defaultConfigPath();
    const cmd =
      process.platform === "darwin" ? "open" :
      process.platform === "win32" ? "start" :
      "xdg-open";
    try {
      // `start` on Windows needs to go through cmd.exe; for simplicity we
      // detach in all cases and ignore the child's exit.
      const child = spawn(cmd, [target], { detached: true, stdio: "ignore" });
      child.on("error", () => { /* swallow — already responded */ });
      child.unref();
      res.json({ ok: true, path: target });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });
}
