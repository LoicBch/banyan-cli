/**
 * Detect the banyan context (project, repo, feature) from a cwd.
 *
 * Used internally by:
 *   - project name inference at the top-level CLI dispatcher
 *   - cwd-aware shortcuts in `bn start` (infer the feature from a worktree)
 *   - `bn ports` to default to the feature inferred from cwd
 *
 * Covers:
 *   - cwd IS a repo root     → { project, repo, inMainRepo: true }
 *   - cwd inside repo        → same
 *   - cwd is a worktree root → { project, repo, feature, worktreePath }
 *   - cwd inside worktree    → same
 *   - no match               → undefined
 */
import path from "node:path";
import { realpathSync } from "node:fs";
import type { Config, ProjectConfig, RepoConfig } from "./config.js";
import * as naming from "./naming.js";
import { UsageError } from "./errors.js";

export interface LocationContext {
  project: ProjectConfig;
  repo?: RepoConfig;          // nearest repo match from cwd
  feature?: string;            // extracted from worktree path if cwd is inside a worktree
  worktreePath?: string;       // full worktree path
  inMainRepo: boolean;         // true if cwd is inside the repo itself (not a worktree sibling)
}

export function resolveLocation(cfg: Config, cwd: string): LocationContext | undefined {
  const resolved = canonical(cwd);

  let best:
    | {
        project: ProjectConfig;
        repo: RepoConfig;
        match: "main" | "worktree";
        repoPath: string;
        feature?: string;
      }
    | undefined;

  for (const project of cfg.projects) {
    for (const repo of project.repos) {
      const repoPath = canonical(repo.path);
      // Main checkout?
      if (resolved === repoPath || resolved.startsWith(repoPath + path.sep)) {
        if (!best || repoPath.length > best.repoPath.length) {
          best = { project, repo, match: "main", repoPath };
        }
        continue;
      }
      // Worktree (new layout: <parent>/worktree-<basename>/<feature>,
      //          legacy layout: <repoPath>-<feature>) — handled by naming.
      const parsed = naming.parseWorktreePath(resolved, repoPath);
      if (parsed) {
        if (!best || repoPath.length > best.repoPath.length) {
          best = {
            project,
            repo,
            match: "worktree",
            repoPath,
            feature: parsed.feature,
          };
        }
      }
    }
  }

  if (!best) return undefined;

  if (best.match === "main") {
    return { project: best.project, repo: best.repo, inMainRepo: true };
  }
  // worktree
  const feature = best.feature!;
  const wtPath = naming.existingWorktreePath(best.repoPath, feature)
    ?? naming.worktreePath(best.repoPath, feature);
  return {
    project: best.project,
    repo: best.repo,
    feature,
    worktreePath: wtPath,
    inMainRepo: false,
  };
}

/**
 * Resolve the feature arg of a per-project command, falling back to the
 * worktree the user is currently in. Used by lifecycle/worktree/env
 * subcommands that take `<branch>` — pass `[branch]` to commander, then
 * call this to either use what they typed or infer it from cwd.
 *
 * Throws UsageError if no feature is provided and cwd isn't inside a
 * worktree of `projectName`. The error message names the command so the
 * user knows what's missing.
 */
export function resolveFeatureFromCwd(
  cfg: Config,
  projectName: string,
  provided: string | undefined,
  commandHint: string,
): string {
  if (provided) return provided;
  const loc = resolveLocation(cfg, process.cwd());
  if (loc?.feature && loc.project.name === projectName) return loc.feature;
  throw new UsageError(
    `no <feature> given and cwd isn't in a worktree of '${projectName}'. ` +
      `pass it explicitly: bn ${projectName} ${commandHint} <feature>`,
  );
}

/** Resolve path and follow symlinks (e.g. /tmp → /private/tmp on macOS). */
function canonical(p: string): string {
  const abs = path.resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}
