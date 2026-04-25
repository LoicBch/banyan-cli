import type { Config, ProjectConfig, RepoConfig } from "../config.js";
import { logger } from "../logger.js";
import * as docker from "../docker.js";
import { ConfigError, UsageError } from "../errors.js";
import { run } from "../exec.js";

/** Find all compose-type repos in a project. Errors if none defined. */
function composeRepos(project: ProjectConfig): RepoConfig[] {
  const r = project.repos.filter((r) => r.type === "compose");
  if (r.length === 0) {
    throw new UsageError(
      `project "${project.name}" has no compose repos. add one with type=compose + composeFile`,
    );
  }
  return r;
}

/**
 * `bn <project> env ls` — list currently known compose stacks for this project,
 * with their running state. Groups by feature.
 */
export async function envLs(config: Config, projectName: string): Promise<void> {
  const project = config.projects.find((p) => p.name === projectName);
  if (!project) throw new ConfigError(`unknown project "${projectName}"`);
  composeRepos(project);

  const r = await run("docker", ["compose", "ls", "--all", "--format", "json"]);
  if (r.code !== 0) {
    throw new UsageError(`docker compose ls failed: ${r.stderr.trim()}`);
  }
  const prefix = projectName + "-";
  let stacks: Array<{ Name: string; Status: string; ConfigFiles?: string }>;
  try {
    stacks = JSON.parse(r.stdout);
  } catch {
    stacks = [];
  }
  const mine = stacks.filter((s) => s.Name.startsWith(prefix));
  if (mine.length === 0) {
    logger.info(`no active compose stacks for ${projectName}`);
    return;
  }
  logger.info(`active compose stacks:`);
  for (const s of mine) {
    const feature = s.Name.slice(prefix.length);
    const running = s.Status.includes("running") ? "● running" : "○ stopped";
    logger.info(`  ${feature}  ${running}`);
    logger.info(`    status: ${s.Status}`);
  }
}

export async function envLogs(
  config: Config,
  projectName: string,
  feature: string,
  service?: string,
): Promise<void> {
  const project = config.projects.find((p) => p.name === projectName);
  if (!project) throw new ConfigError(`unknown project "${projectName}"`);
  const repos = composeRepos(project);
  // If multiple compose repos exist, tail logs from the first one by default.
  const repo = repos[0]!;
  await docker.logs(repo, project, feature, service);
}

export async function envExec(
  config: Config,
  projectName: string,
  feature: string,
  service: string,
  cmd: string[],
): Promise<void> {
  const project = config.projects.find((p) => p.name === projectName);
  if (!project) throw new ConfigError(`unknown project "${projectName}"`);
  const repos = composeRepos(project);
  const repo = repos[0]!;
  await docker.exec(repo, project, feature, service, cmd.length > 0 ? cmd : ["sh"]);
}

export async function envRecreate(
  config: Config,
  projectName: string,
  feature: string,
): Promise<void> {
  const project = config.projects.find((p) => p.name === projectName);
  if (!project) throw new ConfigError(`unknown project "${projectName}"`);
  const repos = composeRepos(project);
  for (const repo of repos) {
    logger.info(`recreating stack for ${repo.name}…`);
    await docker.recreate(repo, project, feature);
    logger.ok(`stack recreated: ${docker.composeProjectName(project, feature)}`);
  }
}

/**
 * `bn <project> env up <feature>` — start the compose stacks for a feature
 * without touching git worktrees. Useful to add infra to an existing feature
 * that was created before the compose repo was configured.
 */
export async function envUp(
  config: Config,
  projectName: string,
  feature: string,
): Promise<void> {
  const project = config.projects.find((p) => p.name === projectName);
  if (!project) throw new ConfigError(`unknown project "${projectName}"`);
  const repos = composeRepos(project);
  for (const repo of repos) {
    logger.info(`starting compose stack for ${repo.name} (${feature})…`);
    await docker.up(repo, project, feature);
    logger.ok(`stack up: ${docker.composeProjectName(project, feature)}`);
  }
}

/**
 * `bn <project> env down <feature>` — stop the compose stacks for a feature
 * without removing volumes (data preserved). Mirror of `env up`.
 */
export async function envDown(
  config: Config,
  projectName: string,
  feature: string,
): Promise<void> {
  const project = config.projects.find((p) => p.name === projectName);
  if (!project) throw new ConfigError(`unknown project "${projectName}"`);
  const repos = composeRepos(project);
  for (const repo of repos) {
    logger.info(`stopping compose stack for ${repo.name} (${feature})…`);
    await docker.down(repo, project, feature);
    logger.ok(`stack stopped: ${docker.composeProjectName(project, feature)} (volumes kept)`);
  }
}
