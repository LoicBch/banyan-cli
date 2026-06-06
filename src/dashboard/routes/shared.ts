/**
 * Shared types and helpers consumed by route modules under
 * `src/dashboard/routes/`.
 *
 * Most routes need just `config` (the in-memory snapshot) — keeping the
 * type minimal means simple routes (state, actions, history) don't have
 * to type out unused dependencies. Routes that need more (integrations,
 * wizard, worktree) declare extended dependency interfaces in their own
 * file and the server wires them up explicitly.
 */
import type { Request, Response } from "express";
import type { Config } from "../../config.js";

/** What every route module gets handed when it's registered. */
export interface RouteDeps {
  /** Mutable in-memory config — mutated in place by `/api/projects` so the
   *  routes that close over it see the new project immediately. */
  config: Config;
}

/** Guard for required JSON body fields. Replies 400 and returns `false` on
 *  the first missing one so the route can bail without nesting. */
export function requireFields(
  req: Request,
  res: Response,
  fields: readonly string[],
): boolean {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const missing = fields.filter((f) => body[f] == null || body[f] === "");
  if (missing.length > 0) {
    res.status(400).json({ ok: false, error: `missing fields: ${missing.join(", ")}` });
    return false;
  }
  return true;
}

/** 404 when a project name isn't in the in-memory config. Returns true
 *  if the response has been sent so the caller can short-circuit. */
export function rejectUnknownProject(
  config: Config,
  projectName: string,
  res: Response,
): boolean {
  if (!config.projects.some((p) => p.name === projectName)) {
    res.status(404).json({ error: `unknown project '${projectName}'` });
    return true;
  }
  return false;
}
