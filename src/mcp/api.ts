/**
 * MCP API surface — thin wrappers around banyan internals that return
 * structured data (not just log to stdout). Each function maps 1:1 to a
 * registered MCP tool.
 *
 * Conventions:
 *  - Read-only ops return rich JSON.
 *  - Action ops return `{ ok: true, ... }` on success or throw a UsageError
 *    that the MCP layer translates into a tool error.
 *  - All paths returned are absolute, all branch/feature names are unsanitized.
 */

import { existsSync } from "node:fs";
import { loadConfig, type Config, type ProjectConfig } from "../config.js";
import * as git from "../git.js";
import * as docker from "../docker.js";
import * as naming from "../naming.js";
import { run } from "../exec.js";
import { wtAll } from "../commands/wtAll.js";
import { wtRm } from "../commands/wtRm.js";
import { cleanup } from "../commands/cleanup.js";
import { merge as mergeCmd } from "../commands/merge.js";
import { rebase as rebaseCmd } from "../commands/rebase.js";
import { test as testCmd } from "../commands/test.js";
import { testStop as testStopCmd } from "../commands/testStop.js";
import { envUp, envDown, envRecreate } from "../commands/env.js";
import { buildContext } from "../context.js";
import { ConfigError, UsageError } from "../errors.js";

async function getConfig(): Promise<Config> {
  return loadConfig();
}

function getProject(config: Config, name: string): ProjectConfig {
  const p = config.projects.find((p) => p.name === name);
  if (!p) throw new ConfigError(`unknown project "${name}"`);
  return p;
}

// ---------------------------------------------------------------------------
// Discovery / read-only
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<{
  projects: Array<{ name: string; repos: string[]; layoutScript?: string }>;
}> {
  const config = await getConfig();
  return {
    projects: config.projects.map((p) => ({
      name: p.name,
      repos: p.repos.map((r) => r.name),
      layoutScript: p.layoutScript,
    })),
  };
}

export async function projectInfo(
  projectName: string,
): Promise<{
  name: string;
  layoutScript?: string;
  deployCommand?: string;
  repos: Array<{
    name: string;
    type: "git" | "compose";
    path: string;
    baseBranch?: string;
    composeFile?: string;
    run?: {
      command: string;
      port?: number;
      portEnv?: string;
      setup?: string;
      stopCommand?: string;
      env?: Record<string, string>;
      composePorts?: Record<string, string>;
    };
    deployCommand?: string;
  }>;
}> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  return {
    name: project.name,
    layoutScript: project.layoutScript,
    deployCommand: project.deployCommand,
    repos: project.repos.map((r) => ({
      name: r.name,
      type: r.type ?? "git",
      path: r.path,
      baseBranch: r.baseBranch,
      composeFile: r.composeFile,
      run: r.run,
      deployCommand: r.deployCommand,
    })),
  };
}

export async function listFeatures(projectName: string): Promise<{
  features: Array<{
    feature: string;
    repos: Array<{ name: string; worktreePath: string; branch: string }>;
  }>;
}> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  // Discover features by scanning sibling worktree dirs of each git repo
  const featureMap = new Map<
    string,
    Array<{ name: string; worktreePath: string; branch: string }>
  >();
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    const worktrees = await git.worktreeList(repo.path).catch(() => []);
    for (const wt of worktrees) {
      // Main checkout's path matches the repo path; skip it.
      if (wt.path === repo.path) continue;
      const base = wt.path.startsWith(`${repo.path}-`)
        ? wt.path.slice(repo.path.length + 1)
        : null;
      if (!base) continue;
      const list = featureMap.get(base) ?? [];
      list.push({
        name: repo.name,
        worktreePath: wt.path,
        branch: wt.branch ?? "(detached)",
      });
      featureMap.set(base, list);
    }
  }
  return {
    features: Array.from(featureMap.entries()).map(([feature, repos]) => ({
      feature,
      repos,
    })),
  };
}

export async function featureStatus(
  projectName: string,
  feature: string,
): Promise<{
  feature: string;
  repos: Array<{
    name: string;
    type: string;
    worktreePath?: string;
    branch?: string;
    exists: boolean;
    head?: string;
    dirty?: boolean;
    aheadOfBase?: number;
  }>;
}> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const repos: Array<{
    name: string;
    type: string;
    worktreePath?: string;
    branch?: string;
    exists: boolean;
    head?: string;
    dirty?: boolean;
    aheadOfBase?: number;
  }> = [];
  for (const r of project.repos) {
    if (r.type === "compose") {
      repos.push({ name: r.name, type: "compose", exists: true });
      continue;
    }
    const wt = naming.worktreePath(r.path, feature);
    const exists = existsSync(wt);
    if (!exists) {
      repos.push({ name: r.name, type: "git", worktreePath: wt, exists: false });
      continue;
    }
    const branch = naming.branchName(feature);
    const head = await git.currentHead(wt).catch(() => undefined);
    const dirty = await git.hasUncommittedChanges(wt).catch(() => undefined);
    const base = await git.defaultBranch(r.path, r.baseBranch);
    const aheadOfBase = await git
      .commitsAhead(wt, `origin/${base}`)
      .catch(() => undefined);
    repos.push({
      name: r.name,
      type: "git",
      worktreePath: wt,
      branch,
      exists: true,
      head,
      dirty,
      aheadOfBase,
    });
  }
  return { feature, repos };
}

export async function listStacks(projectName: string): Promise<{
  stacks: Array<{ feature: string; running: boolean; status: string }>;
}> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const r = await run("docker", ["compose", "ls", "--all", "--format", "json"]);
  if (r.code !== 0) return { stacks: [] };
  let parsed: Array<{ Name: string; Status: string }>;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { stacks: [] };
  }
  const prefix = project.name + "-";
  return {
    stacks: parsed
      .filter((s) => s.Name.startsWith(prefix))
      .map((s) => ({
        feature: s.Name.slice(prefix.length),
        running: s.Status.includes("running"),
        status: s.Status,
      })),
  };
}

export async function getStackPorts(
  projectName: string,
  feature: string,
): Promise<{
  stack: string;
  ports: Array<{ service: string; containerPort: number; hostPort: number }>;
}> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const composeRepo = project.repos.find((r) => r.type === "compose");
  if (!composeRepo) {
    throw new UsageError(`project "${projectName}" has no compose repo`);
  }
  if (!(await docker.isUp(composeRepo, project, feature))) {
    return {
      stack: docker.composeProjectName(project, feature),
      ports: [],
    };
  }
  // Use composePorts spec from any non-compose repo to know which ports to ask for
  const ports: Array<{ service: string; containerPort: number; hostPort: number }> = [];
  const seen = new Set<string>();
  for (const r of project.repos) {
    const spec = r.run?.composePorts ?? {};
    for (const target of Object.values(spec)) {
      const [service, portStr] = target.split(":");
      if (!service || !portStr) continue;
      const containerPort = parseInt(portStr, 10);
      const key = `${service}:${containerPort}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hostPort = await docker.servicePort(
        composeRepo,
        project,
        feature,
        service,
        containerPort,
      );
      if (hostPort) ports.push({ service, containerPort, hostPort });
    }
  }
  return {
    stack: docker.composeProjectName(project, feature),
    ports,
  };
}

export async function stackLogs(
  projectName: string,
  feature: string,
  service?: string,
  tail = 100,
): Promise<{ logs: string }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const composeRepo = project.repos.find((r) => r.type === "compose");
  if (!composeRepo) throw new UsageError(`project "${projectName}" has no compose repo`);
  const composeProject = docker.composeProjectName(project, feature);
  const args = [
    "compose",
    "-p",
    composeProject,
    "-f",
    composeRepo.composeFile?.startsWith("/")
      ? composeRepo.composeFile
      : `${composeRepo.path}/${composeRepo.composeFile}`,
    "--project-directory",
    composeRepo.path,
    "logs",
    "--tail",
    String(tail),
  ];
  if (service) args.push(service);
  const r = await run("docker", args);
  return { logs: (r.stdout || "") + (r.stderr || "") };
}

// ---------------------------------------------------------------------------
// Lifecycle (state-changing)
// ---------------------------------------------------------------------------

export async function createFeature(
  projectName: string,
  feature: string,
  repos?: string[],
): Promise<{ ok: true; feature: string }> {
  const config = await getConfig();
  await wtAll(config, projectName, feature, repos && repos.length > 0 ? { only: repos } : {});
  return { ok: true, feature };
}

export async function removeFeature(
  projectName: string,
  feature: string,
  repo?: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const targets = repo ? [repo] : project.repos.map((r) => r.name);
  for (const r of targets) {
    await wtRm(buildContext(config, projectName, { feature, repoName: r }));
  }
  return { ok: true };
}

export async function cleanupFeature(
  projectName: string,
  feature: string,
  repo?: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const targets = repo ? [repo] : project.repos.map((r) => r.name);
  for (const r of targets) {
    await cleanup(buildContext(config, projectName, { feature, repoName: r }));
  }
  return { ok: true };
}

export async function startTest(
  projectName: string,
  feature: string,
  repos?: string[],
): Promise<{ ok: true; feature: string }> {
  const config = await getConfig();
  await testCmd(config, projectName, feature, repos);
  return { ok: true, feature };
}

export async function stopTest(
  projectName: string,
  feature: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  await testStopCmd(buildContext(config, projectName, { feature }), feature);
  return { ok: true };
}

export async function stackUp(
  projectName: string,
  feature: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  await envUp(config, projectName, feature);
  return { ok: true };
}

export async function stackDown(
  projectName: string,
  feature: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  await envDown(config, projectName, feature);
  return { ok: true };
}

export async function stackRecreate(
  projectName: string,
  feature: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  await envRecreate(config, projectName, feature);
  return { ok: true };
}

export async function rebaseFeature(
  projectName: string,
  feature: string,
  repo?: string,
  base?: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const targets = repo ? [repo] : project.repos.map((r) => r.name).filter((n) => {
    const r = project.repos.find((x) => x.name === n)!;
    return r.type !== "compose";
  });
  for (const r of targets) {
    await rebaseCmd(buildContext(config, projectName, { feature, repoName: r }), { base });
  }
  return { ok: true };
}

export async function mergeFeature(
  projectName: string,
  feature: string,
  repo?: string,
  opts: { autoResolve?: boolean; strategy?: "squash" | "merge" | "rebase"; local?: boolean } = {},
): Promise<{ ok: true }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const targets = repo ? [repo] : project.repos.map((r) => r.name).filter((n) => {
    const r = project.repos.find((x) => x.name === n)!;
    return r.type !== "compose";
  });
  for (const r of targets) {
    await mergeCmd(buildContext(config, projectName, { feature, repoName: r }), {
      autoResolve: opts.autoResolve ?? true, // default to auto in MCP
      strategy: opts.strategy,
      local: opts.local,
    });
  }
  return { ok: true };
}
