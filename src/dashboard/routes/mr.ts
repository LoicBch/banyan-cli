/**
 * MR/PR status lookup — lazy per-worktree. The Pipeline view hits this on
 * demand (button click), not on the polling timer, since the underlying
 * `gh`/`glab` calls are slow.
 */
import type { Express, Request, Response } from "express";
import { actionMrStatus } from "../actions.js";
import type { RouteDeps } from "./shared.js";

export function register(app: Express, deps: RouteDeps): void {
  const { config } = deps;

  app.get(
    "/api/mr/:project/:repo/:feature",
    async (req: Request<{ project: string; repo: string; feature: string }>, res: Response) => {
      const { project, repo, feature } = req.params;
      const r = await actionMrStatus(config, { project, repo, feature });
      res.status(r.ok ? 200 : 400).json(r);
    },
  );
}
