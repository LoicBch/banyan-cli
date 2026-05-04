import { getProject, saveConfig, type Config } from "../config.js";
import { logger } from "../logger.js";
import { ConfigError } from "../errors.js";

export async function removeRepo(
  config: Config,
  projectName: string,
  repoName: string,
): Promise<Config> {
  const project = getProject(config, projectName);
  if (!project.repos.some((r) => r.name === repoName)) {
    throw new ConfigError(
      `unknown repo "${repoName}" in project "${projectName}"`,
    );
  }
  if (project.repos.length <= 1) {
    throw new ConfigError(
      `cannot remove last repo from project "${projectName}". remove the project instead with: bn ${projectName} remove`,
    );
  }

  const next: Config = {
    ...config,
    projects: config.projects.map((p) =>
      p.name === projectName
        ? { ...p, repos: p.repos.filter((r) => r.name !== repoName) }
        : p,
    ),
  };
  await saveConfig(next);
  logger.ok(`removed repo "${repoName}" from project "${projectName}"`);
  return next;
}
