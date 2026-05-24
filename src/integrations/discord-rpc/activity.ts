/**
 * Build Discord Rich Presence activity from Banyan state.
 */
import type { BanyanActivity, DiscordRpcConfig } from "./config.js";

export interface DiscordActivity {
  details?: string;
  state?: string;
  startTimestamp?: number;
  largeImageKey?: string;
  largeImageText?: string;
  smallImageKey?: string;
  smallImageText?: string;
  buttons?: Array<{ label: string; url: string }>;
}

/**
 * Build a Discord activity object from Banyan state.
 */
export function buildActivity(
  activity: BanyanActivity,
  config: DiscordRpcConfig,
): DiscordActivity | null {
  if (!activity.features.length && !activity.project) {
    // No active work
    return null;
  }

  const details: string[] = [];
  const state: string[] = [];

  // Project name
  if (config.showProject && activity.project) {
    details.push(`Project: ${activity.project}`);
  }

  // Feature count
  if (config.showFeatureCount && activity.features.length > 0) {
    const count = activity.features.length;
    const plural = count > 1 ? "features" : "feature";
    state.push(`${count} ${plural}`);

    // Show first feature name if only one
    if (count === 1) {
      state.push(`(${activity.features[0]})`);
    }
  }

  // Mode info (show most common mode if multiple features)
  if (config.showMode && activity.features.length > 0) {
    const modes = Object.values(activity.modes);
    const modeCount = modes.reduce((acc, mode) => {
      acc[mode] = (acc[mode] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const mostCommonMode = Object.entries(modeCount).sort(([, a], [, b]) => b - a)[0]?.[0];
    if (mostCommonMode) {
      state.push(`• ${mostCommonMode} mode`);
    }
  }

  const result: DiscordActivity = {
    largeImageKey: config.largeImageKey,
    largeImageText: config.largeImageText,
  };

  if (details.length > 0) {
    result.details = details.join(" • ");
  }

  if (state.length > 0) {
    result.state = state.join(" ");
  }

  // Start timestamp (if available)
  if (activity.startTime) {
    try {
      result.startTimestamp = Math.floor(new Date(activity.startTime).getTime() / 1000);
    } catch {
      // Invalid timestamp, ignore
    }
  }

  // Dashboard button
  if (activity.dashboardUrl) {
    result.buttons = [
      {
        label: "View Dashboard",
        url: activity.dashboardUrl,
      },
    ];
  }

  return result;
}
