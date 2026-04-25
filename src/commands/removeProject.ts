import type { Config } from "../config.js";
import { saveConfig } from "../config.js";
import { logger } from "../logger.js";
import { ConfigError } from "../errors.js";

export async function removeProject(
  config: Config,
  projectName: string,
): Promise<Config> {
  if (!config.projects.some((p) => p.name === projectName)) {
    throw new ConfigError(`unknown project "${projectName}"`);
  }

  const next: Config = {
    ...config,
    projects: config.projects.filter((p) => p.name !== projectName),
  };
  await saveConfig(next);
  logger.ok(`removed project "${projectName}"`);
  logger.info(
    `worktrees and branches in the repos are untouched — clean them up manually if needed`,
  );
  return next;
}
