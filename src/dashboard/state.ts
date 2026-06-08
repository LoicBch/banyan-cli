import path from "node:path";
import type { Config, ProjectConfig, RepoConfig } from "../config.js";
import * as git from "../git.js";
import * as docker from "../docker.js";
import * as tmux from "../tmux.js";
import { run } from "../exec.js";

export interface DashboardWorktree {
  feature: string;
  branch: string;
  path: string;
  exists: boolean;
  paneLive: boolean;
}

export interface DashboardRepo {
  name: string;
  type: "git" | "compose";
  path: string;
  baseBranch?: string;
  composeFile?: string;
  worktrees: DashboardWorktree[];      // only for git repos
  stacks: DashboardStack[];            // only for compose repos
  run?: {
    command: string;
    port?: number;
    portEnv?: string;
    composePorts?: Record<string, string>;
  };
}

export interface DashboardStack {
  feature: string;
  running: boolean;
  status: string;
  services: DashboardService[];
}

export interface DashboardService {
  name: string;
  state: string;
  hostPort?: number;
  containerPort?: number;
}

export interface DashboardProject {
  name: string;
  sessionRunning: boolean;
  repos: DashboardRepo[];
}

export interface DashboardState {
  projects: DashboardProject[];
  generatedAt: string;
}

/** Build a full snapshot of what banyan currently sees. */
export async function buildState(config: Config): Promise<DashboardState> {
  const projects: DashboardProject[] = [];

  for (const project of config.projects) {
    const sessionRunning = await safeHasSession(project.name);
    const paneTags = sessionRunning ? await safeListPaneTags(project.name) : new Set<string>();
    const activeStacks = await listProjectStacks(project.name);

    const repos: DashboardRepo[] = [];
    for (const repo of project.repos) {
      if (repo.type === "compose") {
        repos.push({
          name: repo.name,
          type: "compose",
          path: repo.path,
          composeFile: repo.composeFile,
          worktrees: [],
          stacks: await collectStacks(project, repo, activeStacks),
        });
      } else {
        repos.push({
          name: repo.name,
          type: "git",
          path: repo.path,
          baseBranch: repo.baseBranch,
          worktrees: await collectWorktrees(repo, paneTags),
          stacks: [],
          run: repo.run
            ? {
                command: repo.run.command,
                port: repo.run.port,
                portEnv: repo.run.portEnv,
                composePorts: repo.run.composePorts,
              }
            : undefined,
        });
      }
    }

    projects.push({
      name: project.name,
      sessionRunning,
      repos,
    });
  }

  return { projects, generatedAt: new Date().toISOString() };
}

async function safeHasSession(name: string): Promise<boolean> {
  try {
    return await tmux.hasSession(name);
  } catch {
    return false;
  }
}

async function safeListPaneTags(session: string): Promise<Set<string>> {
  try {
    return new Set(await tmux.listBanyanPaneTags(session));
  } catch {
    return new Set();
  }
}

async function collectWorktrees(
  repo: RepoConfig,
  livePaneTags: Set<string>,
): Promise<DashboardWorktree[]> {
  try {
    const entries = await git.worktreeList(repo.path);
    const primary = path.resolve(repo.path);
    const out: DashboardWorktree[] = [];
    for (const e of entries) {
      if (path.resolve(e.path) === primary) continue;
      const feature = stripFeaturePrefix(e.branch) ?? path.basename(e.path);
      const tag = `${repo.name}-${feature}`;
      out.push({
        feature,
        branch: e.branch ?? "",
        path: e.path,
        exists: true,
        paneLive: livePaneTags.has(tag),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function stripFeaturePrefix(branch: string | undefined): string | undefined {
  if (!branch) return undefined;
  return branch.startsWith("feature/") ? branch.slice("feature/".length) : branch;
}

/**
 * `docker compose ls --all` returns every known compose project;
 * we filter by banyan naming convention `<project>-<feature>`.
 */
async function listProjectStacks(projectName: string): Promise<
  Array<{ Name: string; Status: string }>
> {
  const r = await run("docker", ["compose", "ls", "--all", "--format", "json"]);
  if (r.code !== 0) return [];
  try {
    const all = JSON.parse(r.stdout) as Array<{ Name: string; Status: string }>;
    const prefix = projectName + "-";
    return all.filter((s) => s.Name.startsWith(prefix));
  } catch {
    return [];
  }
}

async function collectStacks(
  project: ProjectConfig,
  repo: RepoConfig,
  active: Array<{ Name: string; Status: string }>,
): Promise<DashboardStack[]> {
  const prefix = project.name + "-";
  const stacks: DashboardStack[] = [];
  for (const s of active) {
    const feature = s.Name.slice(prefix.length);
    const running = /running/i.test(s.Status);
    const services = running ? await collectServices(repo, project, feature) : [];
    stacks.push({
      feature,
      running,
      status: s.Status,
      services,
    });
  }
  return stacks;
}

async function collectServices(
  repo: RepoConfig,
  project: ProjectConfig,
  feature: string,
): Promise<DashboardService[]> {
  try {
    return (await docker.psServices(repo, project, feature)).map((s) => ({
      name: s.name,
      state: s.state,
    }));
  } catch {
    return [];
  }
}
