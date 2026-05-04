import path from "node:path";
import { existsSync } from "node:fs";
import type { Config, ProjectConfig, RepoConfig } from "../config.js";
import * as git from "../git.js";
import * as tmux from "../tmux.js";

export interface SidebarWorktree {
  feature: string;                 // short name, e.g. "login"
  branch: string;                  // full branch name, e.g. "feature/login"
  path: string;                    // worktree path on disk
  paneStatus: "running" | "idle" | "missing";
  currentCommand?: string;         // what the pane is running (best-effort)
}

export interface SidebarRepo {
  name: string;
  path: string;
  baseBranch?: string;
  worktrees: SidebarWorktree[];
}

export interface SidebarProject {
  name: string;
  sessionRunning: boolean;
  repos: SidebarRepo[];
}

export interface SidebarSnapshot {
  projects: SidebarProject[];
  error?: string;
  fetchedAt: number;
}

/**
 * Load a full snapshot of the config + worktrees + tmux state.
 * Catches errors per project so a broken repo doesn't crash the whole sidebar.
 */
export async function loadSnapshot(config: Config): Promise<SidebarSnapshot> {
  const projects: SidebarProject[] = [];

  for (const project of config.projects) {
    const sessionRunning = await safeHasSession(project.name);
    const paneTitles = sessionRunning ? await safeListPaneTitles(project.name) : new Set<string>();

    const repos: SidebarRepo[] = [];
    for (const repo of project.repos) {
      const worktrees = await safeLoadWorktrees(project, repo, paneTitles);
      repos.push({
        name: repo.name,
        path: repo.path,
        baseBranch: repo.baseBranch,
        worktrees,
      });
    }

    projects.push({ name: project.name, sessionRunning, repos });
  }

  return { projects, fetchedAt: Date.now() };
}

async function safeHasSession(name: string): Promise<boolean> {
  try {
    return await tmux.hasSession(name);
  } catch {
    return false;
  }
}

/**
 * Query tmux for pane titles in the session, so we can correlate worktrees
 * to live agent panes. Uses the `@banyan-pane` option we set in `wt`.
 */
async function safeListPaneTitles(session: string): Promise<Set<string>> {
  try {
    const titles = await tmux.listBanyanPaneTags(session);
    return new Set(titles);
  } catch {
    return new Set();
  }
}

async function safeLoadWorktrees(
  _project: ProjectConfig,
  repo: RepoConfig,
  livePanes: Set<string>,
): Promise<SidebarWorktree[]> {
  try {
    const entries = await git.worktreeList(repo.path);
    const primary = path.resolve(repo.path);
    return entries
      .filter((e) => path.resolve(e.path) !== primary)
      .map((e) => {
        const feature = stripFeaturePrefix(e.branch);
        const tag = feature ? `${repo.name}-${feature}` : "";
        const isLive = tag && livePanes.has(tag);
        const exists = existsSync(e.path);
        return {
          feature: feature ?? path.basename(e.path),
          branch: e.branch ?? "",
          path: e.path,
          paneStatus: !exists ? "missing" : (isLive ? "running" : "idle"),
        } satisfies SidebarWorktree;
      });
  } catch {
    return [];
  }
}

function stripFeaturePrefix(branch: string | undefined): string | undefined {
  if (!branch) return undefined;
  const prefix = "feature/";
  return branch.startsWith(prefix) ? branch.slice(prefix.length) : branch;
}
