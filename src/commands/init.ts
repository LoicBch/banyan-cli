import { existsSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import { saveConfig, expandHome } from "../config.js";
import { logger } from "../logger.js";
import { UsageError, ConfigError } from "../errors.js";

export interface InitOpts {
  repoName?: string;
  path?: string;
  layout?: string;
}

export async function init(
  config: Config,
  projectName: string,
  opts: InitOpts,
): Promise<Config> {
  if (config.projects.some((p) => p.name === projectName)) {
    throw new ConfigError(`project "${projectName}" already exists`);
  }

  const repoPath = path.resolve(expandHome(opts.path ?? process.cwd()));
  if (!existsSync(repoPath)) {
    throw new UsageError(`path does not exist: ${repoPath}`);
  }

  const repoName = opts.repoName ?? path.basename(repoPath);
  const layout = opts.layout ? path.resolve(expandHome(opts.layout)) : undefined;
  if (layout && !existsSync(layout)) {
    throw new UsageError(`layout script not found: ${layout}`);
  }

  const next: Config = {
    ...config,
    projects: [
      ...config.projects,
      {
        name: projectName,
        layoutScript: layout,
        repos: [{ name: repoName, path: repoPath }],
      },
    ],
  };

  await saveConfig(next);
  logger.ok(`created project "${projectName}" with repo "${repoName}" → ${repoPath}`);
  if (!layout) {
    logger.info(
      `no layoutScript set. add one later with: bn ${projectName} set-layout <path>`,
    );
  }
  logger.info(`add more repos with: bn ${projectName} add-repo <name> [path]`);
  return next;
}
