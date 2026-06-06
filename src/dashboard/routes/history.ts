/**
 * Recorded lifecycle history for a project — merges, cleanups, rebases.
 *
 * Source of truth is the append-only `.history.jsonl` file written by the
 * CLI commands; this route just slices/filters it.
 */
import type { Express, Request, Response } from "express";
import { readHistoryEvents } from "../../history.js";
import { rejectUnknownProject, type RouteDeps } from "./shared.js";

export function register(app: Express, deps: RouteDeps): void {
  const { config } = deps;

  app.get(
    "/api/history/:project",
    (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      if (rejectUnknownProject(config, projectName, res)) return;
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
}
