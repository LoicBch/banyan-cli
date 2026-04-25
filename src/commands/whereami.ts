import path from "node:path";
import { realpathSync } from "node:fs";
import type { Config, ProjectConfig, RepoConfig } from "../config.js";

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

  let best: { project: ProjectConfig; repo?: RepoConfig; match: "main" | "worktree" | null; repoPath?: string } | undefined;

  for (const project of cfg.projects) {
    for (const repo of project.repos) {
      const repoPath = canonical(repo.path);
      let match: "main" | "worktree" | null = null;
      if (resolved === repoPath || resolved.startsWith(repoPath + path.sep)) {
        match = "main";
      } else if (resolved.startsWith(repoPath + "-")) {
        match = "worktree";
      }
      if (match) {
        if (!best || repoPath.length > (best.repoPath?.length ?? 0)) {
          best = { project, repo, match, repoPath };
        }
      }
    }
  }

  // If we found a specific repo match, return it with full context.
  if (best?.repo && best.match) {
    if (best.match === "main") {
      return { project: best.project, repo: best.repo, inMainRepo: true };
    }
    // worktree: extract feature from "<repoPath>-<feature>[/rest]"
    const afterDash = resolved.slice((best.repoPath?.length ?? 0) + 1);
    const feature = afterDash.split(path.sep)[0];
    const worktreePath = `${best.repoPath}-${feature}`;
    return {
      project: best.project,
      repo: best.repo,
      feature,
      worktreePath,
      inMainRepo: false,
    };
  }

  return undefined;
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

function shellEscape(s: string): string {
  // single-quoted strings in shell: replace ' with '\''
  return s.replace(/'/g, `'\\''`);
}
