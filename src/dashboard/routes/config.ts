/**
 * Repo run-config editor — what the dashboard's Config tab reads and writes.
 *
 * Reads come from `readConfigForDashboard` which always pulls from disk so
 * the editor reflects what's saved (not the in-memory copy that
 * `/api/projects` mutates). Writes go through `updateRepoRun` which
 * preserves comments via `YAML.parseDocument`.
 */
import type { Express } from "express";
import { updateRepoRun, readConfigForDashboard } from "../configWrite.js";
import { requireFields } from "./shared.js";

export function register(app: Express): void {
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
}
