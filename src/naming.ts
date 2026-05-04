import path from "node:path";
import { existsSync } from "node:fs";

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

export function branchName(feature: string): string {
  return `feature/${feature}`;
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
