import { existsSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import { saveConfig, expandHome } from "../config.js";
import { logger } from "../logger.js";
import { UsageError, ConfigError } from "../errors.js";

export async function setLayout(
  config: Config,
  projectName: string,
  layoutInput: string,
): Promise<Config> {
  if (!config.projects.some((p) => p.name === projectName)) {
    throw new ConfigError(`unknown project "${projectName}"`);
  }

  const layout = path.resolve(expandHome(layoutInput));
  if (!existsSync(layout)) {
    throw new UsageError(`layout script not found: ${layout}`);
  }

  const next: Config = {
    ...config,
    projects: config.projects.map((p) =>
      p.name === projectName ? { ...p, layoutScript: layout } : p,
    ),
  };
  await saveConfig(next);
  logger.ok(`layout script for "${projectName}" set to ${layout}`);
  return next;
}
