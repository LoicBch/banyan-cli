import { existsSync } from "node:fs";
import path from "node:path";
import { getProject, saveConfig, expandHome, type Config, type RepoConfig } from "../config.js";
import { logger } from "../logger.js";
import { UsageError, ConfigError } from "../errors.js";
import { inferRun } from "../inferRun.js";

export async function addRepo(
  config: Config,
  projectName: string,
  repoName: string,
  repoPathInput?: string,
): Promise<Config> {
  const project = getProject(config, projectName);
  if (project.repos.some((r) => r.name === repoName)) {
    throw new ConfigError(
      `repo "${repoName}" already exists in project "${projectName}"`,
    );
  }

  const repoPath = path.resolve(expandHome(repoPathInput ?? process.cwd()));
  if (!existsSync(repoPath)) {
    throw new UsageError(`path does not exist: ${repoPath}`);
  }

  // Heuristic detection of the dev run command. Saves the user a manual
  // `set-run` for common stacks. Silent if nothing was recognised — they
  // can always set it manually with `bn <project> set-run <repo>`.
  const inferred = inferRun(repoPath);
  const newRepo: RepoConfig = {
    name: repoName,
    path: repoPath,
    ...(inferred ? { run: inferred.run } : {}),
  };

  const next: Config = {
    ...config,
    projects: config.projects.map((p) =>
      p.name === projectName ? { ...p, repos: [...p.repos, newRepo] } : p,
    ),
  };
  await saveConfig(next);
  logger.ok(`added repo "${repoName}" → ${repoPath} to project "${projectName}"`);
  if (inferred) {
    logger.info(``);
    logger.ok(`detected stack: ${inferred.stack}`);
    logger.info(`  command:  ${inferred.run.command}`);
    if (inferred.run.port !== undefined) logger.info(`  port:     ${inferred.run.port}`);
    if (inferred.run.portEnv) logger.info(`  portEnv:  ${inferred.run.portEnv}`);
    logger.info(`override with: bn ${projectName} set-run ${repoName} ...`);
  } else {
    logger.info(``);
    logger.info(
      `no run config detected (stack not recognised). configure with: bn ${projectName} set-run ${repoName} -c "<command>" [-p <port>] [--port-env <var>]`,
    );
  }
  return next;
}
