import path from "node:path";
import { existsSync } from "node:fs";
import * as git from "./git.js";
import { UsageError } from "./errors.js";

/**
 * Canonical path for a new worktree.
 *
 * Layout: `<repo-parent>/worktree-<repo-basename>/<feature>`
 * Example: `~/Documents/Dev/MyApp/MyAppFront` + `alert-zone`
 *      → `~/Documents/Dev/MyApp/worktree-MyAppFront/alert-zone`
 *
 * Groups every feature worktree of a repo under a single `worktree-<repo>`
 * folder, instead of polluting the repo's parent directory with siblings.
 */
export function worktreePath(repoPath: string, feature: string): string {
  return path.join(
    path.dirname(repoPath),
    `worktree-${path.basename(repoPath)}`,
    feature,
  );
}

/**
 * Legacy worktree layout: `<repo>-<feature>` sibling of the main checkout.
 * Kept for backward-compat detection of worktrees created before the layout
 * change. Never used for fresh creates.
 */
export function legacyWorktreePath(repoPath: string, feature: string): string {
  return `${repoPath}-${feature}`;
}

/**
 * Returns whichever worktree path actually exists on disk for this
 * (repo, feature) pair: the new layout, the legacy layout, or undefined if
 * neither. Use this for any operation that targets an existing worktree
 * (cleanup, status, rebase, etc.).
 */
export function existingWorktreePath(
  repoPath: string,
  feature: string,
): string | undefined {
  const newP = worktreePath(repoPath, feature);
  if (existsSync(newP)) return newP;
  const legP = legacyWorktreePath(repoPath, feature);
  if (existsSync(legP)) return legP;
  return undefined;
}

/**
 * For a candidate worktree absolute path, return the (repo path, feature)
 * pair it belongs to, against either layout. Used for cwd detection.
 */
export function parseWorktreePath(
  candidate: string,
  repoPath: string,
): { feature: string } | undefined {
  // New layout: <parent>/worktree-<basename>/<feature>[/...]
  const newRoot = path.join(
    path.dirname(repoPath),
    `worktree-${path.basename(repoPath)}`,
  );
  if (
    candidate === newRoot ||
    candidate.startsWith(newRoot + path.sep)
  ) {
    const rel = candidate.slice(newRoot.length + 1);
    const feature = rel.split(path.sep)[0];
    if (feature) return { feature };
  }
  // Legacy layout: <repoPath>-<feature>[/...]
  if (candidate.startsWith(repoPath + "-")) {
    const afterDash = candidate.slice(repoPath.length + 1);
    const feature = afterDash.split(path.sep)[0];
    if (feature) return { feature };
  }
  return undefined;
}

/**
 * Validate a feature identifier. The feature name is used as a tmux window
 * suffix, a state file path component, a pane title, and a worktree subdir.
 * `/` breaks all of those (invalid in tmux window names, creates nested dirs
 * in state.ts, and parseWorktreePath only takes the first segment). Branches
 * with prefixes belong on the `--prefix` flag, not in the feature ID.
 */
export function assertValidFeature(feature: string): void {
  if (feature.includes("/")) {
    const last = feature.split("/").pop()!;
    const prefix = feature.slice(0, feature.length - last.length - 1);
    throw new UsageError(
      `feature names can't contain '/'. use --prefix to set a branch prefix:\n` +
        `  bn <project> wt ${last} --prefix ${prefix}\n` +
        `→ branch: ${prefix}/${last}, feature id: ${last}`,
    );
  }
  if (feature.length === 0) {
    throw new UsageError("feature name cannot be empty");
  }
}

/**
 * Default convention: `feature/<feature>`. Kept as the fallback when no
 * existing worktree is found, and as the format used by `formatBranchName`
 * when no custom prefix is provided.
 */
export function branchName(feature: string): string {
  return `feature/${feature}`;
}

/**
 * Build a branch name at creation time, with optional custom prefix.
 *  - prefix omitted        → `feature/<feature>` (default convention)
 *  - prefix === ""         → `<feature>` (no prefix)
 *  - prefix === "fix"      → `fix/<feature>`
 *  - prefix === "release/v1" → `release/v1/<feature>` (multi-segment ok)
 */
export function formatBranchName(feature: string, prefix?: string): string {
  if (prefix === undefined) return branchName(feature);
  if (prefix === "") return feature;
  return `${prefix.replace(/\/+$/, "")}/${feature}`;
}

/**
 * Find the actual branch of a feature's worktree by asking git directly.
 * Git is the source of truth — the worktree may have been created with a
 * non-default prefix (`--prefix`), so recomputing from convention is
 * unsafe. Falls back to the default `feature/<feature>` if no matching
 * worktree exists (e.g., context built before the worktree is created).
 */
export async function resolveBranchName(
  repoPath: string,
  feature: string,
): Promise<string> {
  try {
    const wts = await git.worktreeList(repoPath);
    for (const wt of wts) {
      if (wt.path === repoPath) continue;
      const parsed = parseWorktreePath(wt.path, repoPath);
      if (parsed?.feature === feature && wt.branch) {
        return wt.branch;
      }
    }
  } catch {
    // fall through to default
  }
  return branchName(feature);
}

export function windowName(targetName: string, feature: string): string {
  return `${targetName}-${feature}`;
}

export function sessionName(projectName: string): string {
  return projectName;
}

export function agentsWindowName(projectName: string): string {
  return `agents-${projectName}`;
}

export function orchestratorWindowName(projectName: string): string {
  return `orchestrator-${projectName}`;
}
