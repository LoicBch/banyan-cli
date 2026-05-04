/**
 * `bn <proj> ports [feature]` — show port allocations for one or all
 * features. Combines two sources:
 *
 *   1. Runtime state (`~/.config/banyan/state/<project>.<feature>.json`):
 *      ports allocated by `findFreePort` for each repo's run command (e.g.
 *      SERVER_PORT, PORT). Written each `bn start`. May be stale if a
 *      process has been killed externally.
 *
 *   2. Live docker query: host ports of every compose service for the
 *      feature's stack (DB_PORT, PMA_PORT, etc.). Always truthful.
 *
 * Inferred from cwd if no feature is given.
 */
import { getProject, type Config, type ProjectConfig } from "../config.js";
import * as state from "../state.js";
import * as docker from "../docker.js";
import * as naming from "../naming.js";
import { resolveLocation } from "./whereami.js";
import { logger } from "../logger.js";

export async function ports(
  config: Config,
  projectName: string,
  feature: string | undefined,
): Promise<void> {
  const project = getProject(config, projectName);

  const targets = await resolveTargets(project, feature);
  if (targets.length === 0) {
    logger.info(
      `no features with recorded port state for project '${projectName}'. ` +
        `start one with: bn ${projectName} start <feature>`,
    );
    return;
  }

  for (let i = 0; i < targets.length; i++) {
    if (i > 0) logger.info("");
    await printFeaturePorts(project, targets[i]!);
  }
}

async function resolveTargets(
  project: ProjectConfig,
  feature: string | undefined,
): Promise<string[]> {
  if (feature) return [feature];

  // No feature given: try cwd inference first.
  const loc = resolveLocation({ version: 1, projects: [project] }, process.cwd());
  if (loc?.feature) return [loc.feature];

  // Otherwise list every feature with recorded state.
  return state.listFeatureStates(project.name).sort();
}

async function printFeaturePorts(
  project: ProjectConfig,
  feature: string,
): Promise<void> {
  const composeRepos = project.repos.filter((r) => r.type === "compose");
  const composeRepo = composeRepos[0];

  logger.info(`── ${feature} ──────────────────────────────`);

  const fs = state.readFeatureState(project.name, feature);
  if (fs) {
    for (const [repoName, info] of Object.entries(fs.repos)) {
      logger.info(
        `  ${repoName.padEnd(8)} ${info.portEnv}=${info.port}` +
          `  →  http://localhost:${info.port}` +
          (info.canonicalPort !== info.port ? `  (canonical: ${info.canonicalPort})` : ""),
      );
    }
  } else {
    logger.warn(
      `  no run-port state recorded — ` +
        `start the feature first: bn ${project.name} start ${feature}`,
    );
  }

  // Compose ports (live).
  if (composeRepo && (await docker.isUp(composeRepo, project, feature))) {
    const services = await docker.psServices(composeRepo, project, feature).catch(() => []);
    if (services.length > 0) {
      logger.info(`  compose stack (${docker.composeProjectName(project, feature)}):`);
    }
    const serviceNames = new Set(services.map((s) => s.name));
    const composePortsCfg = collectComposePortsForFeature(project);
    for (const [envVar, target] of Object.entries(composePortsCfg)) {
      const [svcName, portStr] = target.split(":");
      if (!svcName || !serviceNames.has(svcName)) continue;
      const containerPort = parseInt(portStr ?? "", 10);
      if (!Number.isFinite(containerPort)) continue;
      const hostPort = await docker.servicePort(
        composeRepo,
        project,
        feature,
        svcName,
        containerPort,
      );
      if (hostPort) {
        logger.info(
          `    ${envVar.padEnd(10)} ${svcName}:${containerPort}  →  :${hostPort}`,
        );
      }
    }
  } else if (composeRepo) {
    logger.info(`  compose stack: not running for '${feature}'`);
  }
}

function collectComposePortsForFeature(project: ProjectConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of project.repos) {
    if (r.type === "compose") continue;
    for (const [k, v] of Object.entries(r.run?.composePorts ?? {})) {
      out[k] = v;
    }
  }
  return out;
}

// We only use `naming` indirectly through `resolveLocation`, but keep the
// import explicit so future dev sees the dependency.
void naming;
