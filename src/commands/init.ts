import { existsSync } from "node:fs";
import path from "node:path";
import type { Config } from "../config.js";
import { saveConfig, expandHome } from "../config.js";
import { logger } from "../logger.js";
import { UsageError, ConfigError } from "../errors.js";
import { setupTmuxOnInit } from "../tmuxSetup.js";

export interface InitOpts {
  repoName?: string;
  path?: string;
}

/** Register a new project in the banyan config. Does NOT launch the
 *  workspace — that's `bn <project> start`. The two-step model keeps
 *  `init` predictable (it's just a config write) and lets the user add
 *  more repos via `bn <project> add-repo` before starting. */
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

  const next: Config = {
    ...config,
    projects: [
      ...config.projects,
      {
        name: projectName,
        repos: [{ name: repoName, path: repoPath }],
      },
    ],
  };

  await saveConfig(next);
  logger.ok(`created project "${projectName}" with repo "${repoName}" → ${repoPath}`);

  // Tmux shortcut bootstrap. Idempotent: re-renders only when stale; prompts
  // to wire `~/.tmux.conf` only on first init (when the source-file line is
  // missing). Subsequent inits / banyan upgrades stay silent.
  await setupTmuxOnInit();

  logger.info(``);
  logger.info(`next steps:`);
  logger.info(`  bn ${projectName} add-repo <name> [path]   # for each additional repo`);
  logger.info(`  bn ${projectName} start                    # launch the workspace`);
  return next;
}
