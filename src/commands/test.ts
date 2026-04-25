import { existsSync } from "node:fs";
import type { Config, ProjectConfig, RepoConfig } from "../config.js";
import * as naming from "../naming.js";
import * as tmux from "../tmux.js";
import * as docker from "../docker.js";
import { findFreePort } from "../util/port.js";
import { logger } from "../logger.js";
import { UsageError, ConfigError } from "../errors.js";

interface RepoPlan {
  repo: RepoConfig;
  worktreePath: string;
  command: string;
  port?: number;
  /** `<ENV_VAR>` → { service, containerPort, hostPort } for injected compose ports */
  composePorts?: Array<{
    envVar: string;
    service: string;
    containerPort: number;
    hostPort: number;
  }>;
}

/** Service names or container ports that are "web-accessible" — we print a URL. */
const WEB_SERVICE_HINTS = ["phpmyadmin", "pma", "adminer", "mailpit", "mailhog"];
const WEB_CONTAINER_PORTS = new Set([80, 443, 8080, 8025, 1080]);
function isWebService(service: string, containerPort: number): boolean {
  const s = service.toLowerCase();
  if (WEB_SERVICE_HINTS.some((h) => s.includes(h))) return true;
  return WEB_CONTAINER_PORTS.has(containerPort);
}

/** Minimal shell quoting for env var values (single-quote + escape any quote). */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_:/.@=+,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function test(
  config: Config,
  projectName: string,
  feature: string,
  onlyRepos?: string[],
): Promise<void> {
  const project = config.projects.find((p) => p.name === projectName);
  if (!project) throw new ConfigError(`unknown project "${projectName}"`);

  const selected =
    onlyRepos && onlyRepos.length > 0
      ? project.repos.filter((r) => onlyRepos.includes(r.name))
      : project.repos;

  if (onlyRepos) {
    const unknown = onlyRepos.filter((n) => !project.repos.some((r) => r.name === n));
    if (unknown.length > 0) {
      throw new UsageError(`unknown repo(s): ${unknown.join(", ")}`);
    }
  }

  // Auto-start any compose-type stack that isn't already up for this feature.
  // Only triggered when at least one selected runnable repo needs composePorts
  // (to avoid spinning up infra for tests that don't consume it).
  const needsStack = selected.some(
    (r) => r.type !== "compose" && r.run?.composePorts,
  );
  if (needsStack) {
    for (const r of project.repos) {
      if (r.type !== "compose") continue;
      if (await docker.isUp(r, project, feature)) continue;
      logger.info(`starting compose stack for ${r.name} (${feature})…`);
      await docker.up(r, project, feature);
      logger.ok(`stack up: ${docker.composeProjectName(project, feature)}`);
    }
  }

  // --- Pass 1: allocate ports per selected runnable repo ---
  interface PartialPlan {
    repo: RepoConfig;
    worktreePath: string;
    port?: number;
    portEnv?: string;
    composePorts?: RepoPlan["composePorts"];
  }
  const partials: PartialPlan[] = [];
  for (const r of selected) {
    if (r.type === "compose") continue;
    const wtPath = naming.worktreePath(r.path, feature);
    if (!existsSync(wtPath)) {
      logger.warn(`skip ${r.name}: no worktree at ${wtPath}`);
      continue;
    }
    if (!r.run) {
      logger.warn(`skip ${r.name}: no run config (set with: bn ${projectName} set-run ${r.name} --command ...)`);
      continue;
    }
    let port: number | undefined;
    if (r.run.port !== undefined && r.run.portEnv) {
      port = await findFreePort(r.run.port + 1);
    }
    let resolvedComposePorts: RepoPlan["composePorts"] = undefined;
    if (r.run.composePorts) {
      const resolved = await resolveComposePortsDetailed(project, feature, r.run.composePorts);
      if (resolved.length > 0) resolvedComposePorts = resolved;
    }
    partials.push({ repo: r, worktreePath: wtPath, port, portEnv: r.run.portEnv, composePorts: resolvedComposePorts });
  }

  // --- Pass 2: build a port map for cross-repo references ---
  // `{{<repoName>.port}}` in run.env is replaced by that repo's allocated port.
  const portByRepo = new Map<string, number>();
  for (const p of partials) {
    if (p.port !== undefined) portByRepo.set(p.repo.name, p.port);
  }

  function substituteTemplates(value: string): string {
    return value.replace(/\{\{\s*([\w-]+)\.port\s*\}\}/g, (_m, repoName: string) => {
      const p = portByRepo.get(repoName);
      if (p === undefined) {
        logger.warn(
          `env template {{${repoName}.port}} can't be resolved — ${repoName} has no allocated port in this test run. leaving literal.`,
        );
        return `{{${repoName}.port}}`;
      }
      return String(p);
    });
  }

  // --- Pass 3: build final plans with env prefixes ---
  const plans: RepoPlan[] = [];
  for (const pp of partials) {
    const envPairs: string[] = [];
    if (pp.port !== undefined && pp.portEnv) envPairs.push(`${pp.portEnv}=${pp.port}`);
    for (const cp of pp.composePorts ?? []) envPairs.push(`${cp.envVar}=${cp.hostPort}`);
    // User-declared env (with template substitution)
    for (const [k, v] of Object.entries(pp.repo.run?.env ?? {})) {
      const resolved = substituteTemplates(v);
      envPairs.push(`${k}=${shellQuote(resolved)}`);
    }
    const commandPrefix = envPairs.length > 0 ? envPairs.join(" ") + " " : "";
    const runCommand = `${commandPrefix}${pp.repo.run!.command}`;
    const fullCommand = pp.repo.run!.setup ? `${pp.repo.run!.setup} && ${runCommand}` : runCommand;
    plans.push({
      repo: pp.repo,
      worktreePath: pp.worktreePath,
      command: fullCommand,
      port: pp.port,
      composePorts: pp.composePorts,
    });
  }

  if (plans.length === 0) {
    throw new UsageError(
      `no repos eligible for test '${feature}'. create worktrees with: bn ${projectName} wt-all ${feature}`,
    );
  }

  const session = naming.sessionName(projectName);
  const testWin = `test-${feature}`;

  if ((await tmux.hasSession(session)) && (await tmux.windowExists(session, testWin))) {
    throw new UsageError(
      `test for '${feature}' already running — stop first: bn ${projectName} test-stop ${feature}`,
    );
  }

  const [first, ...rest] = plans;
  if (!first) throw new UsageError("no plans");

  let firstPaneId: string;
  if (!(await tmux.hasSession(session))) {
    firstPaneId = await tmux.newSession(session, testWin, first.worktreePath);
    logger.ok(`tmux session: ${session} (created)`);
    logger.ok(`tmux window: ${session}:${testWin} (created)`);
  } else {
    firstPaneId = await tmux.newWindow(session, testWin, first.worktreePath);
    logger.ok(`tmux window: ${session}:${testWin} (created)`);
  }
  await tmux.setPaneTitle(firstPaneId, first.repo.name);
  await tmux.setPaneUserOption(firstPaneId, "@banyan-pane", first.repo.name);
  await tmux.sendKeys(firstPaneId, first.command, { enter: true });

  for (const plan of rest) {
    const paneId = await tmux.splitWindow(session, testWin, plan.worktreePath);
    await tmux.setPaneTitle(paneId, plan.repo.name);
    await tmux.setPaneUserOption(paneId, "@banyan-pane", plan.repo.name);
    await tmux.sendKeys(paneId, plan.command, { enter: true });
  }

  await tmux.enablePaneBorderLabels(session, testWin);
  await tmux.applyLayout(session, testWin, "tiled");
  await tmux.selectWindow(session, testWin);

  logger.ok(`test '${feature}' started (${plans.length} process${plans.length > 1 ? "es" : ""})`);
  for (const p of plans) {
    const urlPart = p.port ? `  http://localhost:${p.port}` : "";
    logger.info(`  ${p.repo.name}: ${p.command}${urlPart}`);
    if (p.composePorts && p.composePorts.length > 0) {
      for (const cp of p.composePorts) {
        const web = isWebService(cp.service, cp.containerPort);
        const suffix = web ? `  http://localhost:${cp.hostPort}` : "";
        logger.info(
          `    ${cp.envVar.padEnd(10)} → ${cp.service}:${cp.containerPort} → :${cp.hostPort}${suffix}`,
        );
      }
    }
  }
  logger.info(`attach with: bn ${projectName} attach`);
}

/**
 * For each `composePorts` entry, query the active compose stack to find the
 * host-side port mapped to `<service>:<containerPort>`. Returns a detailed
 * record usable both for env-var injection and human-readable logging.
 * Silently skips services that aren't up or ports that aren't exposed.
 */
async function resolveComposePortsDetailed(
  project: ProjectConfig,
  feature: string,
  spec: Record<string, string>,
): Promise<
  Array<{
    envVar: string;
    service: string;
    containerPort: number;
    hostPort: number;
  }>
> {
  const composeRepos = project.repos.filter((r) => r.type === "compose");
  if (composeRepos.length === 0) {
    logger.warn(`composePorts configured but no compose-type repo in project '${project.name}'`);
    return [];
  }
  const composeRepo = composeRepos[0]!;

  // Only inject if the stack is actually up for this feature
  if (!(await docker.isUp(composeRepo, project, feature))) {
    logger.warn(
      `composePorts: stack ${docker.composeProjectName(project, feature)} not running. ` +
        `start it with: bn ${project.name} wt ${feature} infra (or env up ${feature})`,
    );
    return [];
  }

  const out: Array<{
    envVar: string;
    service: string;
    containerPort: number;
    hostPort: number;
  }> = [];
  for (const [envVar, target] of Object.entries(spec)) {
    const [service, portStr] = target.split(":");
    if (!service || !portStr) continue;
    const containerPort = parseInt(portStr, 10);
    if (!Number.isFinite(containerPort)) continue;

    const hostPort = await docker.servicePort(
      composeRepo, project, feature, service, containerPort,
    );
    if (hostPort) {
      out.push({ envVar, service, containerPort, hostPort });
    } else {
      logger.warn(
        `composePorts: couldn't find host port for ${service}:${containerPort} in stack — skipping ${envVar}`,
      );
    }
  }
  return out;
}
