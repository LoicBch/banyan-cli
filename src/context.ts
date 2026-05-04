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
 * Throws if none are applicable.
 */
export function resolveRepos(
  project: ProjectConfig,
  feature: string,
  repoName: string | undefined,
): string[] {
  if (repoName) {
    getRepo(project, repoName); // validates, throws on unknown
    return [repoName];
  }
  const withWorktree = project.repos
    .filter((r) => naming.existingWorktreePath(r.path, feature) !== undefined)
    .map((r) => r.name);
  if (withWorktree.length === 0) {
    throw new UsageError(
      `no worktrees found for feature '${feature}' in project '${project.name}'. ` +
        `either pass a repo explicitly or create a worktree first: bn ${project.name} wt ${feature} <repo>`,
    );
  }
  return withWorktree;
}

export function buildContext(
  config: Config,
  projectName: string,
  opts: BuildContextOpts = {},
): Context {
  const project = getProject(config, projectName);
  const repo = opts.repoName ? getRepo(project, opts.repoName) : undefined;
  const feature = opts.feature;

  return {
    config,
    project,
    repo,
    feature,
    naming: {
      session: naming.sessionName(project.name),
      worktreePath:
        repo && feature
          ? (naming.existingWorktreePath(repo.path, feature)
              ?? naming.worktreePath(repo.path, feature))
          : undefined,
      branchName: feature ? naming.branchName(feature) : undefined,
      windowName:
        repo && feature ? naming.windowName(repo.name, feature) : undefined,
    },
    logger,
  };
}
