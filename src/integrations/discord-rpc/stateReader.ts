/**
 * Read Banyan state and convert it to Discord activity.
 */
import type { Config } from "../../config.js";
import type { BanyanActivity } from "./config.js";
import { buildState } from "../../dashboard/state.js";

/**
 * Build Discord activity from current Banyan state.
 */
export async function readBanyanActivity(
  config: Config,
  dashboardUrl?: string,
): Promise<BanyanActivity> {
  const features = new Set<string>();
  const modes: Record<string, string> = {};
  let activeProject: string | undefined;

  try {
    const state = await buildState(config);

    // Aggregate active features from all projects
    for (const project of state.projects) {
      let hasActiveFeatures = false;

      for (const repo of project.repos) {
        // Count active worktrees (features with a live tmux pane)
        for (const wt of repo.worktrees) {
          if (wt.paneLive) {
            features.add(wt.feature);
            hasActiveFeatures = true;

            // For modes, we could read from session files or pane tags
            // For now, we'll leave modes empty since we don't have direct access
            // The dashboard could be extended to expose this if needed
          }
        }
      }

      // Set active project to first project with live features
      if (hasActiveFeatures && !activeProject) {
        activeProject = project.name;
      }
    }
  } catch (err) {
    console.error("[discord-rpc] Failed to read Banyan state:", (err as Error).message);
  }

  return {
    project: activeProject,
    features: Array.from(features),
    modes,
    startTime: new Date().toISOString(),
    dashboardUrl,
  };
}
