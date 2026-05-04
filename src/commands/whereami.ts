import path from "node:path";
import { realpathSync } from "node:fs";
import type { Config, ProjectConfig, RepoConfig } from "../config.js";
import * as naming from "../naming.js";
import { shellEscapeSingleQuoted } from "../shell.js";

export interface LocationContext {
  project: ProjectConfig;
  repo?: RepoConfig;          // nearest repo match from cwd
  feature?: string;            // extracted from worktree path if cwd is inside a worktree
  worktreePath?: string;       // full worktree path
  inMainRepo: boolean;         // true if cwd is inside the repo itself (not a worktree sibling)
}

/**
 * Detect the banyan context (project, repo, feature) from a cwd.
 * Covers:
 *   - cwd IS a repo root     → { project, repo, inMainRepo: true }
 *   - cwd inside repo        → same
 *   - cwd is a worktree root → { project, repo, feature, worktreePath }
 *   - cwd inside worktree    → same
 *   - no match               → undefined
 */
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
      //          legacy layout: <repoPath>-<feature>) — handled by naming
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

/** Resolve path and follow symlinks (e.g. /tmp → /private/tmp on macOS). */
function canonical(p: string): string {
  const abs = path.resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** `bn whereami` CLI entry — prints shell-evaluable context. */
export async function whereami(config: Config): Promise<void> {
  const ctx = resolveLocation(config, process.cwd());

  if (!ctx) {
    // Not in any configured project — exit with status 1.
    process.stderr.write("no banyan project matches the current directory\n");
    process.exit(1);
  }

  // Emit shell-safe `key='value'` pairs, easy to `eval` or parse.
  const lines: string[] = [];
  lines.push(`project='${shellEscape(ctx.project.name)}'`);
  if (ctx.repo) lines.push(`repo='${shellEscape(ctx.repo.name)}'`);
  if (ctx.feature) lines.push(`feature='${shellEscape(ctx.feature)}'`);
  if (ctx.worktreePath) lines.push(`worktree_path='${shellEscape(ctx.worktreePath)}'`);
  lines.push(`in_main_repo='${ctx.inMainRepo ? "1" : "0"}'`);
  process.stdout.write(lines.join("\n") + "\n");
}

// alias kept for clarity at the call site (`key='${shellEscape(...)}'`)
const shellEscape = shellEscapeSingleQuoted;
