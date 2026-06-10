/**
 * Read Banyan state and convert it to Discord activity.
 *
 * In follow mode we restrict to the pinned project (or fall back to all
 * projects with running sessions). In aggregate mode we include every
 * project that has at least one live agent pane.
 */
import type { Config } from "../../config.js";
import type { BanyanActivity, ProjectActivity } from "./config.js";
import { buildState } from "../../dashboard/state.js";
import * as tmux from "../../tmux.js";
import { getDiscordFocus } from "./focus.js";

const RESERVED_TAGS = new Set(["orchestrator", "terminal", "ops"]);

/**
 * Captured once at module load so Discord's elapsed timer reflects the
 * service lifetime instead of resetting on every poll.
 */
const SERVICE_START = new Date().toISOString();

export async function readBanyanActivity(
  config: Config,
  dashboardUrl?: string,
): Promise<BanyanActivity> {
  const projects: ProjectActivity[] = [];

  try {
    const state = await buildState(config);
    const focus = getDiscordFocus();

    const candidates = focus.mode === "aggregate"
      ? state.projects
      : focus.project
        ? state.projects.filter((p) => p.name === focus.project)
        : state.projects;

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

      const features: string[] = [];
      const seen = new Set<string>();
      for (const tag of liveTags) {
        if (RESERVED_TAGS.has(tag)) continue;
        if (!knownFeatures.has(tag)) continue;
        if (seen.has(tag)) continue;
        seen.add(tag);
        features.push(tag);
      }

      if (features.length === 0) continue;

      projects.push({
        name: project.name,
        features,
        totalWorktrees: knownFeatures.size,
      });
    }
  } catch (err) {
    console.error("[discord-rpc] Failed to read Banyan state:", (err as Error).message);
  }

  return {
    projects,
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
