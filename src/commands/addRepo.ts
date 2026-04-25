import { existsSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import { saveConfig, expandHome } from "../config.js";
import { logger } from "../logger.js";
import { UsageError, ConfigError } from "../errors.js";

export async function addRepo(
  config: Config,
  projectName: string,
  repoName: string,
  repoPathInput?: string,
): Promise<Config> {
  const project = config.projects.find((p) => p.name === projectName);
  if (!project) {
    throw new ConfigError(`unknown project "${projectName}"`);
  }
  if (project.repos.some((r) => r.name === repoName)) {
    throw new ConfigError(
      `repo "${repoName}" already exists in project "${projectName}"`,
    );
  }

  const repoPath = path.resolve(expandHome(repoPathInput ?? process.cwd()));
  if (!existsSync(repoPath)) {
    throw new UsageError(`path does not exist: ${repoPath}`);
  }

  const next: Config = {
    ...config,
    projects: config.projects.map((p) =>
      p.name === projectName
        ? { ...p, repos: [...p.repos, { name: repoName, path: repoPath }] }
        : p,
    ),
  };
  await saveConfig(next);
  logger.ok(`added repo "${repoName}" → ${repoPath} to project "${projectName}"`);
  return next;
}
