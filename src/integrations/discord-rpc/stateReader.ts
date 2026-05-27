/**
 * Read Banyan state and convert it to Discord activity.
 */
import type { Config } from "../../config.js";
import type { BanyanActivity } from "./config.js";
import { buildState } from "../../dashboard/state.js";
import * as tmux from "../../tmux.js";
import { getDiscordFocus } from "./focus.js";

const RESERVED_TAGS = new Set(["orchestrator", "terminal", "ops"]);

/**
 * Captured once at module load so Discord's elapsed timer reflects the
 * service lifetime instead of resetting on every poll.
 */
const SERVICE_START = new Date().toISOString();

const AGGREGATE_LABEL = "All projects";

export async function readBanyanActivity(
  config: Config,
  dashboardUrl?: string,
): Promise<BanyanActivity> {
  const features = new Set<string>();
  const modes: Record<string, string> = {};
  let activeProject: string | undefined;

  try {
    const state = await buildState(config);
    const focus = getDiscordFocus();

    // In aggregate mode we sum every running project. In follow mode we
    // restrict to the pinned project (if any) and fall back to "first
    // project with active features" otherwise.
    const candidates = focus.mode === "aggregate"
      ? state.projects
      : focus.project
        ? state.projects.filter((p) => p.name === focus.project)
        : state.projects;

    const projectsWithLive: string[] = [];

    for (const project of candidates) {
      if (!project.sessionRunning) continue;

      // The dashboard's `paneLive` flag relies on a `<repo>-<feature>` tag
      // convention that doesn't match what wt-all writes (just `<feature>`),
      // so we read the live agent-pane tags directly from tmux.
      const liveTags = await safeListPaneTags(project.name);
      const knownFeatures = new Set<string>();
      for (const repo of project.repos) {
        for (const wt of repo.worktrees) {
          if (wt.exists) knownFeatures.add(wt.feature);
        }
      }

      let projectHasFeature = false;
      for (const tag of liveTags) {
        if (RESERVED_TAGS.has(tag)) continue;
        if (!knownFeatures.has(tag)) continue;
        // Prefix with project name in aggregate mode so identical feature
        // names across projects don't collide in the Set.
        const key = focus.mode === "aggregate" ? `${project.name}/${tag}` : tag;
        features.add(key);
        projectHasFeature = true;
      }

      if (projectHasFeature) projectsWithLive.push(project.name);
    }

    if (focus.mode === "aggregate") {
      // Label depends on how many projects are actually contributing.
      if (projectsWithLive.length === 0) {
        activeProject = undefined;
      } else if (projectsWithLive.length === 1) {
        activeProject = projectsWithLive[0];
      } else {
        activeProject = `${AGGREGATE_LABEL} (${projectsWithLive.length})`;
      }
    } else {
      activeProject = projectsWithLive[0];
      // If a project is pinned but currently idle, still show its name —
      // beats falling back to a random project the user isn't looking at.
      if (!activeProject && focus.project) {
        const pinned = state.projects.find((p) => p.name === focus.project);
        if (pinned?.sessionRunning) activeProject = pinned.name;
      }
    }
  } catch (err) {
    console.error("[discord-rpc] Failed to read Banyan state:", (err as Error).message);
  }

  return {
    project: activeProject,
    features: Array.from(features),
    modes,
    startTime: SERVICE_START,
    dashboardUrl,
  };
}

async function safeListPaneTags(session: string): Promise<string[]> {
  try {
    return await tmux.listBanyanPaneTags(session);
  } catch {
    return [];
  }
}
