import {
  getProject,
  getRepo,
  type Config,
  type ProjectConfig,
  type RepoConfig,
} from "./config.js";
import * as naming from "./naming.js";
import { logger, type Logger } from "./logger.js";
import { UsageError } from "./errors.js";

export interface Context {
  config: Config;
  project: ProjectConfig;
  repo?: RepoConfig;
  feature?: string;
  naming: {
    session: string;
    worktreePath?: string;
    branchName?: string;
    windowName?: string;
  };
  logger: Logger;
}

export interface BuildContextOpts {
  feature?: string;
  repoName?: string;
}

/**
 * Resolve the list of repo names to act on for a given feature.
 * - If `repoName` is provided → single-element array (validated).
 * - Else → all repos that have an existing worktree for this feature.
 *   When `includeCompose` is set, compose-type repos are also included
 *   (cleanup uses this so `bn cleanup <feature>` tears down the stack
 *   too, not just the worktrees).
 *
 * Resolution accepts both forms:
 *   - feature short name (e.g. "login" after `bn wt login`) — legacy
 *   - full branch name (e.g. "feature/login", "fix/oauth") — new
 *
 * Throws if no repo has the feature/branch (compose repos don't count
 * for the "found something" check — we need at least one git checkout).
 */
export async function resolveRepos(
  project: ProjectConfig,
  feature: string,
  repoName: string | undefined,
  opts: { includeCompose?: boolean } = {},
): Promise<string[]> {
  if (repoName) {
    getRepo(project, repoName); // validates, throws on unknown
    return [repoName];
  }
  const withCheckout: string[] = [];
  for (const r of project.repos) {
    if (r.type === "compose") continue;
    const c = await naming.resolveBranchCheckout(r.path, feature);
    if (c) withCheckout.push(r.name);
  }
  if (withCheckout.length === 0) {
    throw new UsageError(
      `no worktrees found for '${feature}' in project '${project.name}'. ` +
        `either pass a repo explicitly or create a worktree first: bn ${project.name} wt ${feature} <repo>`,
    );
  }
  // Append compose repos when the caller asks. Order matters: compose
  // teardown happens AFTER the git worktrees of the same feature (the
  // cleanup loop iterates in this order and the docker module handles
  // stack stop + volume drop).
  if (opts.includeCompose) {
    for (const r of project.repos) {
      if (r.type === "compose") withCheckout.push(r.name);
    }
  }
  return withCheckout;
}

export async function buildContext(
  config: Config,
  projectName: string,
  opts: BuildContextOpts = {},
): Promise<Context> {
  const project = getProject(config, projectName);
  const repo = opts.repoName ? getRepo(project, opts.repoName) : undefined;
  const inputFeature = opts.feature;

  // If we have (repo, feature), try to resolve the user input against git
  // worktrees. This accepts both "feature short name" (legacy) and "full
  // branch name" (new), and canonicalises to the short name for state /
  // tmux lookups.
  let resolved: naming.BranchCheckout | null = null;
  if (repo && inputFeature) {
    resolved = await naming.resolveBranchCheckout(repo.path, inputFeature);
  }

  // The canonical feature key carried in the context — short name when a
  // worktree is found, else the user input verbatim (covers the
  // creation-time case where the worktree doesn't exist yet).
  const feature = resolved?.featureKey ?? inputFeature;

  // Branch name: ask git when the worktree exists; convention otherwise.
  const branchName =
    repo && feature
      ? await naming.resolveBranchName(repo.path, feature)
      : feature
        ? naming.branchName(feature)
        : undefined;

  // Worktree path: prefer the resolved one (handles both feature shortname
  // and full branch lookups). Fall back to the conventional path for
  // creation-time use (`wt`).
  const worktreePath =
    resolved?.path
    ?? (repo && feature
      ? (naming.existingWorktreePath(repo.path, feature)
          ?? naming.worktreePath(repo.path, feature))
      : undefined);

  return {
    config,
    project,
    repo,
    feature,
    naming: {
      session: naming.sessionName(project.name),
      worktreePath,
      branchName,
      windowName:
        repo && feature ? naming.windowName(repo.name, feature) : undefined,
    },
    logger,
  };
}
