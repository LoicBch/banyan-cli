import type { Config } from "../config.js";
import { runInherit } from "../exec.js";
import { logger } from "../logger.js";
import { UsageError, ConfigError } from "../errors.js";

export async function deploy(
  config: Config,
  projectName: string,
  repoName: string | undefined,
  extraArgs: string[],
): Promise<number> {
  const project = config.projects.find((p) => p.name === projectName);
  if (!project) throw new ConfigError(`unknown project "${projectName}"`);

  let command: string;
  let scope: string;

  if (repoName) {
    const repo = project.repos.find((r) => r.name === repoName);
    if (!repo) throw new ConfigError(`unknown repo "${repoName}" in project "${projectName}"`);
    if (!repo.deployCommand) {
      throw new UsageError(
        `no deployCommand set for ${projectName}/${repoName}. add 'deployCommand: "..."' to the repo in ~/.config/banyan/config.yaml`,
      );
    }
    command = repo.deployCommand;
    scope = `${projectName}/${repoName}`;
  } else {
    if (!project.deployCommand) {
      throw new UsageError(
        `no deployCommand set for project "${projectName}". add 'deployCommand: "..."' at the project level in ~/.config/banyan/config.yaml, or target a specific repo: bn ${projectName} deploy <repo>`,
      );
    }
    command = project.deployCommand;
    scope = projectName;
  }

  const fullCommand = extraArgs.length > 0 ? `${command} ${extraArgs.join(" ")}` : command;
  logger.info(`deploying ${scope}: ${fullCommand}`);
  logger.info("");

  const code = await runInherit("/bin/bash", ["-c", fullCommand]);
  if (code !== 0) {
    logger.error(`deploy exited with code ${code}`);
  }
  return code;
}
