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

  // Feature count + names. Discord's `state` field caps at ~128 chars, so
  // we fit as many names as we can and surface the overflow as "+N more".
  if (config.showFeatureCount && activity.features.length > 0) {
    state.push(formatFeatureList(activity.features));
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

  // Dashboard button — Discord only accepts https:// URLs (no localhost),
  // so we only emit a button in remote/tunneled mode.
  if (activity.dashboardUrl && /^https:\/\//.test(activity.dashboardUrl)) {
    result.buttons = [
      {
        label: "View Dashboard",
        url: activity.dashboardUrl,
      },
    ];
  }

  return result;
}

const STATE_MAX = 110; // leave headroom for the appended mode suffix

function formatFeatureList(features: string[]): string {
  const count = features.length;
  const plural = count > 1 ? "features" : "feature";
  const prefix = `${count} ${plural}: `;

  let included = 0;
  let acc = "";
  for (const name of features) {
    const sep = included === 0 ? "" : ", ";
    const tentative = acc + sep + name;
    const remaining = count - included - 1;
    const suffix = remaining > 0 ? ` +${remaining} more` : "";
    if ((prefix + tentative + suffix).length > STATE_MAX) break;
    acc = tentative;
    included += 1;
  }

  if (included === 0) {
    // Single name too long even on its own — fall back to plain count.
    return `${count} ${plural}`;
  }

  const omitted = count - included;
  return omitted > 0 ? `${prefix}${acc} +${omitted} more` : `${prefix}${acc}`;
}
