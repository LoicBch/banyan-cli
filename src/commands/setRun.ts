import type { Config, RepoConfig, RunConfig } from "../config.js";
import { saveConfig } from "../config.js";
import { logger } from "../logger.js";
import { ConfigError } from "../errors.js";

export interface SetRunOpts {
  command?: string;
  port?: number;
  portEnv?: string;
  setup?: string;
  clear?: boolean;
}

export async function setRun(
  config: Config,
  projectName: string,
  repoName: string,
  opts: SetRunOpts,
): Promise<Config> {
  const project = config.projects.find((p) => p.name === projectName);
  if (!project) throw new ConfigError(`unknown project "${projectName}"`);
  const repo = project.repos.find((r) => r.name === repoName);
  if (!repo) throw new ConfigError(`unknown repo "${repoName}" in project "${projectName}"`);

  const noOpts =
    opts.command === undefined &&
    opts.port === undefined &&
    opts.portEnv === undefined &&
    opts.setup === undefined &&
    !opts.clear;

  if (noOpts) {
    // show current config
    if (!repo.run) {
      logger.info(`no run config for ${projectName}/${repoName}`);
      logger.info(
        `set with: bn ${projectName} set-run ${repoName} --command <cmd> [--port <n>] [--port-env <var>]`,
      );
    } else {
      logger.info(`run config for ${projectName}/${repoName}:`);
      logger.info(`  command:  ${repo.run.command}`);
      if (repo.run.port !== undefined) logger.info(`  port:     ${repo.run.port}`);
      if (repo.run.portEnv) logger.info(`  portEnv:  ${repo.run.portEnv}`);
      if (repo.run.setup) logger.info(`  setup:    ${repo.run.setup}`);
      if (repo.run.composePorts && Object.keys(repo.run.composePorts).length > 0) {
        logger.info(`  composePorts:`);
        for (const [k, v] of Object.entries(repo.run.composePorts)) {
          logger.info(`    ${k}: ${v}`);
        }
      }
    }
    return config;
  }

  let nextRun: RunConfig | undefined;

  if (opts.clear) {
    nextRun = undefined;
  } else {
    const command = opts.command ?? repo.run?.command;
    if (!command) {
      throw new ConfigError(
        `--command is required (no existing run config to merge with)`,
      );
    }
    nextRun = {
      command,
      ...(opts.port !== undefined
        ? { port: opts.port }
        : repo.run?.port !== undefined
          ? { port: repo.run.port }
          : {}),
      ...(opts.portEnv
        ? { portEnv: opts.portEnv }
        : repo.run?.portEnv
          ? { portEnv: repo.run.portEnv }
          : {}),
      ...(opts.setup
        ? { setup: opts.setup }
        : repo.run?.setup
          ? { setup: repo.run.setup }
          : {}),
      // composePorts is edit-via-YAML only for now; preserve existing value.
      ...(repo.run?.composePorts ? { composePorts: repo.run.composePorts } : {}),
    };
  }

  const updateRepo = (r: RepoConfig): RepoConfig =>
    r.name === repoName
      ? nextRun
        ? { ...r, run: nextRun }
        : (({ run: _dropped, ...rest }) => rest)(r)
      : r;

  const next: Config = {
    ...config,
    projects: config.projects.map((p) =>
      p.name === projectName ? { ...p, repos: p.repos.map(updateRepo) } : p,
    ),
  };
  await saveConfig(next);
  if (opts.clear) {
    logger.ok(`cleared run config for ${projectName}/${repoName}`);
  } else {
    logger.ok(`updated run config for ${projectName}/${repoName}`);
    if (nextRun) {
      logger.info(`  command:  ${nextRun.command}`);
      if (nextRun.port !== undefined) logger.info(`  port:     ${nextRun.port}`);
      if (nextRun.portEnv) logger.info(`  portEnv:  ${nextRun.portEnv}`);
      if (nextRun.setup) logger.info(`  setup:    ${nextRun.setup}`);
    }
  }
  return next;
}
