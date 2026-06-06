/**
 * "New project" wizard endpoints — tech profiles list, filesystem browser,
 * path probe, and the actual project creation that appends to config.yaml.
 *
 * The fs browser + probe + create are filesystem-introspection routes —
 * when the dashboard is exposed via a public tunnel (--remote), we refuse
 * them outright so an attacker who guesses the bearer token can't
 * enumerate $HOME or mutate config.
 */
import type { Express } from "express";
import { homedir } from "node:os";
import { loadConfig } from "../../config.js";
import {
  listFsEntries,
  probePath,
  createProject,
  listTechProfiles,
  type CreateProjectInput,
} from "../wizard.js";
import type { RouteDeps } from "./shared.js";

interface WizardDeps extends RouteDeps {
  /** True when the dashboard is in local mode (no auth gate). FS browser
   *  and project creation are restricted to local mode. */
  filesystemRoutesEnabled: boolean;
}

export function register(app: Express, deps: WizardDeps): void {
  const { config, filesystemRoutesEnabled } = deps;

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
}
