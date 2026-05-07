import { existsSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import { saveConfig, expandHome } from "../config.js";
import { logger } from "../logger.js";
import { UsageError, ConfigError } from "../errors.js";
import { buildContext } from "../context.js";
import { start } from "./start.js";

export interface InitOpts {
  repoName?: string;
  path?: string;
  layout?: string;
  /** Skip the auto-launch of the workspace (orchestrator + terminal pane).
   *  Default behaviour is to launch it immediately, since the workspace is
   *  the foundation of a banyan project — not optional infrastructure to
   *  set up later. Use --no-start when you want to register additional
   *  repos via `bn <project> add-repo` before starting the orchestrator. */
  start?: boolean;
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

  // Auto-launch the workspace unless the caller opted out. The workspace
  // (orchestrator pane + terminal pane) is the foundation of every banyan
  // project — `bn init` is the moment that foundation is laid.
  if (opts.start !== false) {
    logger.info(`launching workspace…`);
    const ctx = await buildContext(next, projectName);
    const code = await start(ctx);
    if (code !== 0) process.exit(code);
    return next;
  }

  logger.info(`add more repos with: bn ${projectName} add-repo <name> [path]`);
  logger.info(`launch the workspace with: bn ${projectName} start`);
  return next;
}
