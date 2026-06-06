/**
 * Read-only inspection — listing projects, repos, features, stacks, ports,
 * logs. No state mutation; safe to call from any MCP scope.
 */
import { existsSync } from "node:fs";
import { getProject } from "../../config.js";
import * as git from "../../git.js";
import * as docker from "../../docker.js";
import * as naming from "../../naming.js";
import { run } from "../../exec.js";
import { UsageError } from "../../errors.js";
import { getConfig } from "./shared.js";

export async function listProjects(): Promise<{
  projects: Array<{ name: string; repos: string[] }>;
}> {
  const config = await getConfig();
  return {
    projects: config.projects.map((p) => ({
      name: p.name,
      repos: p.repos.map((r) => r.name),
    })),
  };
}

export async function projectInfo(
  projectName: string,
): Promise<{
  name: string;
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
      const parsed = naming.parseWorktreePath(wt.path, repo.path);
      if (!parsed) continue;
      const list = featureMap.get(parsed.feature) ?? [];
      list.push({
        name: repo.name,
        worktreePath: wt.path,
        branch: wt.branch ?? "(detached)",
      });
      featureMap.set(parsed.feature, list);
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
    const wt = naming.existingWorktreePath(r.path, feature)
      ?? naming.worktreePath(r.path, feature);
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
