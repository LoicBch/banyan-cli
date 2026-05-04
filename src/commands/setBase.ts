import { getProject, saveConfig, type Config } from "../config.js";
import { logger } from "../logger.js";
import { ConfigError } from "../errors.js";

export async function setBase(
  config: Config,
  projectName: string,
  repoName: string,
  base: string,
): Promise<Config> {
  const project = getProject(config, projectName);
  if (!project.repos.some((r) => r.name === repoName)) {
    throw new ConfigError(`unknown repo "${repoName}" in project "${projectName}"`);
  }

  const next: Config = {
    ...config,
    projects: config.projects.map((p) =>
      p.name === projectName
        ? {
            ...p,
            repos: p.repos.map((r) =>
              r.name === repoName ? { ...r, baseBranch: base } : r,
            ),
          }
        : p,
    ),
  };
  await saveConfig(next);
  logger.ok(`set base branch for ${projectName}/${repoName} → ${base}`);
  return next;
}
