/**
 * Best-effort project inference from a working directory.
 *
 * Lets the CLI accept `bn wt menu-clean` (no project arg) when the user is
 * inside a known project's repo or its parent. The inference is purely
 * lexical (path prefix matching) plus the worktree-aware resolveLocation.
 */
import path from "node:path";
import { realpathSync } from "node:fs";
import type { Config } from "./config.js";
import { resolveLocation } from "./location.js";

/**
 * Returns the project name to prepend to argv when none was given.
 *
 * 1. If cwd is inside a configured repo (or a sibling worktree), return
 *    that repo's project — same logic as `bn whereami`.
 * 2. Otherwise, if cwd is the parent dir of one (and only one) project's
 *    repos, return that project. Resolves the case where you're in
 *    `~/Documents/Dev/MyApp/` (parent of front/back/app) and want
 *    `bn wt foo` to map to `bn myproject wt foo`.
 *
 * Returns undefined if zero or 2+ projects match (ambiguous → require
 * explicit).
 */
export function inferProjectFromCwd(
  config: Config,
  cwd: string,
): string | undefined {
  const direct = resolveLocation(config, cwd);
  if (direct) return direct.project.name;

  const cwdCanonical = canonical(cwd);
  const matches = config.projects.filter((p) =>
    p.repos.some((r) => {
      const repoCanonical = canonical(r.path);
      return repoCanonical.startsWith(cwdCanonical + path.sep);
    }),
  );
  if (matches.length === 1) return matches[0]!.name;
  return undefined;
}

function canonical(p: string): string {
  const abs = path.resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}
