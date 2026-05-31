import { getProject, saveConfig, type Config, type RepoConfig } from "../config.js";
import { logger } from "../logger.js";
import { UsageError } from "../errors.js";
import { inferRun } from "../inferRun.js";

export interface InferRunOpts {
  /** Apply detection to all repos in the project. */
  all?: boolean;
  /** Overwrite existing run config (default: skip repos that already
   *  have one set, to avoid clobbering manual edits). */
  force?: boolean;
}

/** Re-run heuristic detection on one or more repos and persist the result.
 *  Useful when the stack changed (e.g. switched from npm to pnpm) or when a
 *  repo was added before banyan knew how to detect that stack. */
export async function inferRunCmd(
  config: Config,
  projectName: string,
  repoName: string | undefined,
  opts: InferRunOpts = {},
): Promise<Config> {
  const project = getProject(config, projectName);

  let targets: RepoConfig[];
  if (opts.all || repoName === undefined) {
    targets = project.repos.filter((r) => r.type !== "compose");
  } else {
    const r = project.repos.find((r) => r.name === repoName);
    if (!r) throw new UsageError(`unknown repo "${repoName}" in project "${projectName}"`);
    targets = [r];
  }

  let mutated = false;
  const updates = new Map<string, RepoConfig>();

  for (const r of targets) {
    if (r.run && !opts.force) {
      logger.info(`${r.name}: already has run config (use --force to overwrite)`);
      continue;
    }
    const inferred = inferRun(r.path);
    if (!inferred) {
      logger.info(`${r.name}: stack not recognised (skipped)`);
      continue;
    }
    logger.ok(`${r.name}: detected ${inferred.stack}`);
    logger.info(`  command:  ${inferred.run.command}`);
    if (inferred.run.port !== undefined) logger.info(`  port:     ${inferred.run.port}`);
    if (inferred.run.portEnv) logger.info(`  portEnv:  ${inferred.run.portEnv}`);
    updates.set(r.name, { ...r, run: inferred.run });
    mutated = true;
  }

  if (!mutated) return config;

  const next: Config = {
    ...config,
    projects: config.projects.map((p) =>
      p.name === projectName
        ? {
            ...p,
            repos: p.repos.map((r) => updates.get(r.name) ?? r),
          }
        : p,
    ),
  };
  await saveConfig(next);
  logger.info(``);
  logger.ok(`saved`);
  return next;
}
