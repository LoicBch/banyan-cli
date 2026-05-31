import { effectiveRunCommand, getProject, type Config, type ProjectConfig, type RepoConfig } from "../config.js";
import * as naming from "../naming.js";
import * as tmux from "../tmux.js";
import * as docker from "../docker.js";
import * as state from "../state.js";
import { shellQuote } from "../shell.js";
import { findFreePort } from "../util/port.js";
import { logger } from "../logger.js";
import { UsageError } from "../errors.js";

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

interface RepoCheckout {
  repo: RepoConfig;
  path: string;
  isMainCheckout: boolean;
}

const KILL_GRACE_MS = 1500;
const STOP_CMD_GRACE_MS = 1500;

/** Service names or container ports that are "web-accessible" — we print a URL. */
const WEB_SERVICE_HINTS = ["phpmyadmin", "pma", "adminer", "mailpit", "mailhog"];
const WEB_CONTAINER_PORTS = new Set([80, 443, 8080, 8025, 1080]);
function isWebService(service: string, containerPort: number): boolean {
  const s = service.toLowerCase();
  if (WEB_SERVICE_HINTS.some((h) => s.includes(h))) return true;
  return WEB_CONTAINER_PORTS.has(containerPort);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Idempotent feature-stack runner. Behaviour depends on whether a
 * `test-<feature>` tmux window already exists:
 *   - missing → create the window with one pane per selected repo and start
 *     each run command (allocates ports, brings up compose stacks if needed).
 *   - exists  → for every selected repo whose pane is already there,
 *     Ctrl-C + optional stopCommand, then re-send a freshly-planned run
 *     command. Repos without a pane yet are added as new splits.
 *
 * `onlyRepos` filters to a subset; omitting it targets every repo of the
 * project. Compose-type repos are always handled by the compose autostart
 * logic and never get their own pane.
 */
export async function test(
  config: Config,
  projectName: string,
  branch: string,
  onlyRepos?: string[],
): Promise<void> {
  // We accept full branch names here (with `/`), so the strict feature-name
  // validation doesn't apply. We still want to reject empty input.
  if (!branch || branch.trim().length === 0) {
    throw new UsageError("branch name cannot be empty");
  }

  const project = getProject(config, projectName);

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

  // Pre-flight: for each selected git repo, find a checkout matching the
  // input. The input is interpreted as either a banyan feature short name
  // (legacy `bn start login` after `bn wt login`) or a full branch name
  // (`bn start develop`, `bn start feature/login`). Resolution is per-repo
  // because some repos may have the branch and others may not.
  const checkouts: RepoCheckout[] = [];
  for (const r of selected) {
    if (r.type === "compose") continue;
    const c = await naming.resolveBranchCheckout(r.path, branch);
    if (c) {
      checkouts.push({ repo: r, path: c.path, isMainCheckout: c.isMainCheckout });
    }
  }
  if (checkouts.length === 0) {
    throw new UsageError(buildResolutionErrorMessage(project, branch));
  }

  // Use the canonical feature key from the first repo that resolved. All
  // repos should produce the same key in practice (same input → same
  // resolution), so this is just a representative.
  const firstResolution = await naming.resolveBranchCheckout(checkouts[0]!.repo.path, branch);
  const feature = firstResolution?.featureKey ?? branch.replace(/\//g, "__");

  const eligible = checkouts.map((c) => c.repo);

  // Auto-start any compose-type stack that isn't already up for this feature.
  // Only triggered when at least one ELIGIBLE runnable repo needs composePorts
  // (avoids spinning up infra for typos or for tests that don't consume it).
  const needsStack = eligible.some((r) => r.run?.composePorts);
  if (needsStack) {
    for (const r of project.repos) {
      if (r.type !== "compose") continue;
      if (await docker.isUp(r, project, feature)) continue;
      logger.info(`starting compose stack for ${r.name} (${feature})…`);
      await docker.up(r, project, feature);
      logger.ok(`stack up: ${docker.composeProjectName(project, feature)}`);
    }
  }

  // --- Pass 1: allocate ports per eligible runnable repo ---
  interface PartialPlan {
    repo: RepoConfig;
    worktreePath: string;
    port?: number;
    portEnv?: string;
    composePorts?: RepoPlan["composePorts"];
  }
  const partials: PartialPlan[] = [];
  const checkoutByName = new Map(checkouts.map((c) => [c.repo.name, c]));
  for (const r of eligible) {
    const wtPath = checkoutByName.get(r.name)!.path;
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
          `env template {{${repoName}.port}} can't be resolved — ${repoName} has no allocated port in this run. leaving literal.`,
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
    const runCommand = `${commandPrefix}${effectiveRunCommand(pp.repo.run!)}`;
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
      `no repos eligible for '${branch}' — none of them have a run config. ` +
        `set one with: bn ${projectName} set-run <repo> --command "<cmd>" [--port <n>] [--port-env <var>]`,
    );
  }

  // ── Persist port allocations so `bn ports` can recall them later ────────
  const repoState: state.FeatureRuntimeState["repos"] = {};
  for (const p of plans) {
    if (p.port !== undefined && p.repo.run?.portEnv && p.repo.run.port !== undefined) {
      repoState[p.repo.name] = {
        port: p.port,
        portEnv: p.repo.run.portEnv,
        canonicalPort: p.repo.run.port,
      };
    }
  }
  state.writeFeatureState({
    project: projectName,
    feature,
    lastStartedAt: new Date().toISOString(),
    repos: repoState,
  });

  // ── Auto adb reverse for Android panes ──────────────────────────────────
  // If a plan's command uses `adb` (heuristic: an Android install/run), wire
  // every sibling repo's canonical→allocated port through `adb reverse` so
  // the device's localhost:<canonical> tunnels to the host:<allocated>.
  // Convention: the user's app code hardcodes `http://localhost:<canonical>/`
  // for debug. banyan handles the dynamic port mapping invisibly — same
  // paradigm as composePorts.
  for (const plan of plans) {
    if (!/(^|\s|&)adb(\s|$)/.test(plan.command)) continue;
    const reverses: string[] = [];
    for (const other of plans) {
      if (other === plan) continue;
      const canonical = other.repo.run?.port;
      const allocated = other.port;
      if (canonical !== undefined && allocated !== undefined) {
        reverses.push(`adb reverse tcp:${canonical} tcp:${allocated}`);
      }
    }
    if (reverses.length > 0) {
      plan.command = `${reverses.join(" && ")} && ${plan.command}`;
      logger.info(
        `adb reverse for ${plan.repo.name}: ${reverses.length} mapping${reverses.length > 1 ? "s" : ""} (device-side: ${plans
          .filter((p) => p !== plan && p.repo.run?.port !== undefined && p.port !== undefined)
          .map((p) => `${p.repo.name}@localhost:${p.repo.run!.port}`)
          .join(", ")})`,
      );
    }
  }

  const session = naming.sessionName(projectName);
  const testWin = `test-${feature}`;

  // ── Branch A: window does not exist → create from scratch ────────────────
  if (!(await tmux.hasSession(session)) || !(await tmux.windowExists(session, testWin))) {
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

    // Free terminal pane for ad-hoc commands (curl, log tail, git status,
    // etc.) while the stack runs. Sits in the same window with no command
    // — just a shell. cwd: first plan's worktree so `git`/`ls` are useful.
    const opsPaneId = await tmux.splitWindow(session, testWin, first.worktreePath);
    await tmux.setPaneTitle(opsPaneId, "ops");
    await tmux.setPaneUserOption(opsPaneId, "@banyan-pane", "ops");

    await tmux.enablePaneBorderLabels(session, testWin);
    await tmux.applyLayout(session, testWin, "tiled");

    logger.ok(
      `started '${feature}' (${plans.length} process${plans.length > 1 ? "es" : ""} + ops terminal)`,
    );
  } else {
    // ── Branch B: window exists → start missing panes, restart existing ───
    let restarted = 0;
    let added = 0;
    for (const plan of plans) {
      const existingPane = await tmux.findPaneByUserOption(
        session,
        testWin,
        "@banyan-pane",
        plan.repo.name,
      );
      if (existingPane) {
        logger.info(`restarting ${plan.repo.name} (Ctrl-C)…`);
        await tmux.sendKeys(existingPane, "C-c", { enter: false });
        await delay(KILL_GRACE_MS);
        const stopCmd = plan.repo.run?.stopCommand;
        if (stopCmd) {
          logger.info(`  stopCommand: ${stopCmd}`);
          await tmux.sendKeys(existingPane, stopCmd, { enter: true });
          await delay(STOP_CMD_GRACE_MS);
        }
        await tmux.sendKeys(existingPane, plan.command, { enter: true });
        restarted++;
      } else {
        const paneId = await tmux.splitWindow(session, testWin, plan.worktreePath);
        await tmux.setPaneTitle(paneId, plan.repo.name);
        await tmux.setPaneUserOption(paneId, "@banyan-pane", plan.repo.name);
        await tmux.sendKeys(paneId, plan.command, { enter: true });
        added++;
      }
    }
    // Make sure the ops terminal pane is there — it may have been created
    // by an earlier banyan, killed by the user, or never existed (legacy
    // test windows from before the ops pane was introduced).
    const existingOps = await tmux.findPaneByUserOption(
      session, testWin, "@banyan-pane", "ops",
    );
    if (!existingOps) {
      const cwd = plans[0]!.worktreePath;
      const opsPaneId = await tmux.splitWindow(session, testWin, cwd);
      await tmux.setPaneTitle(opsPaneId, "ops");
      await tmux.setPaneUserOption(opsPaneId, "@banyan-pane", "ops");
      added++;
    }

    if (added > 0) {
      await tmux.applyLayout(session, testWin, "tiled");
    }
    await tmux.enablePaneBorderLabels(session, testWin);

    const parts: string[] = [];
    if (restarted > 0) parts.push(`${restarted} restarted`);
    if (added > 0) parts.push(`${added} added`);
    logger.ok(`'${feature}' updated (${parts.join(", ")})`);
  }

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
 * Build a helpful error message for the case where `bn start <X>` couldn't
 * resolve `X` to any checkout. Tailors the suggestion based on whether the
 * input matches a configured baseBranch (suggest git checkout) or looks
 * like a feature branch (suggest bn wt).
 */
function buildResolutionErrorMessage(
  project: ProjectConfig,
  input: string,
): string {
  // Is this the baseBranch of any repo in the project?
  const baseBranchRepos = project.repos
    .filter((r) => r.type !== "compose" && r.baseBranch === input)
    .map((r) => r.name);

  if (baseBranchRepos.length > 0) {
    return (
      `branch '${input}' is the baseBranch of ${baseBranchRepos.join(", ")} ` +
        `but isn't checked out anywhere (main checkout is on a different branch). ` +
        `bring it back with: cd <repo-path> && git checkout ${input}`
    );
  }

  // Looks like a feature branch (feature/<X>) → suggest bn wt with the suffix
  if (input.startsWith("feature/")) {
    const short = input.slice("feature/".length);
    return (
      `branch '${input}' has no worktree. ` +
        `create one with: bn ${project.name} wt ${short}`
    );
  }

  // Generic non-feature branch → suggest both options
  return (
    `branch '${input}' is not checked out anywhere. ` +
      `create a worktree with: bn ${project.name} wt ${input}` +
      `${input.includes("/") ? ` --prefix ""` : ""}, ` +
      `or check it out in the main repo: cd <repo-path> && git checkout ${input}`
  );
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
