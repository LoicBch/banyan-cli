/**
 * Build Discord Rich Presence activity from Banyan state.
 *
 * Discord's card is constrained: 2 lines of text (details / state) at ~128
 * chars each, a large image, a small badge, and up to 2 buttons. We pack the
 * most useful signal in:
 *
 *   single-project mode  →  details = feature list, state = project name
 *   aggregate mode       →  details = project list with counts, state = totals
 *
 * Feature/project names are joined with " · " (middot) instead of commas —
 * lighter visually and matches the dashboard's typography.
 */
import type { BanyanActivity, DiscordRpcConfig, ProjectActivity } from "./config.js";

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

const SEPARATOR = " · ";
const DETAILS_MAX = 120;

export function buildActivity(
  activity: BanyanActivity,
  config: DiscordRpcConfig,
): DiscordActivity | null {
  if (activity.projects.length === 0) return null;

  // Build the image fields defensively: Discord silently rejects the
  // *entire* activity update when an imageKey references a non-existent
  // asset (e.g. `banyan-logo` when only `banyan` has been uploaded on
  // the application portal). Only emit a key when it's non-empty.
  const result: DiscordActivity = {};
  if (config.largeImageKey && config.largeImageKey.length > 0) {
    result.largeImageKey = config.largeImageKey;
    if (config.largeImageText) result.largeImageText = config.largeImageText;
  }
  if (config.smallImageKey && config.smallImageKey.length > 0) {
    result.smallImageKey = config.smallImageKey;
    if (config.smallImageText) result.smallImageText = config.smallImageText;
  }

  if (activity.projects.length === 1) {
    const p = activity.projects[0]!;
    result.details = formatFeatureLine(p.features);
    result.state = formatSingleProjectState(p);
  } else {
    result.details = formatProjectLine(activity.projects);
    result.state = formatAggregateState(activity.projects);
  }

  if (activity.startTime) {
    const ts = new Date(activity.startTime).getTime();
    if (!Number.isNaN(ts)) result.startTimestamp = Math.floor(ts / 1000);
  }

  if (activity.dashboardUrl && /^https:\/\//.test(activity.dashboardUrl)) {
    result.buttons = [{ label: "Open Dashboard", url: activity.dashboardUrl }];
  }

  return result;
}

/** "feat-a · feat-b · feat-c · +2" — first line, single-project mode. */
function formatFeatureLine(features: string[]): string {
  if (features.length === 0) return "Idle";
  return joinWithOverflow(features);
}

/** "🌿 my-project · 3 of 5 features" — second line, single-project mode. */
function formatSingleProjectState(p: ProjectActivity): string {
  const head = `🌿 ${p.name}`;
  if (p.features.length === 0) return head;
  const count =
    p.totalWorktrees > p.features.length
      ? `${p.features.length} of ${p.totalWorktrees} features`
      : `${p.features.length} ${p.features.length === 1 ? "feature" : "features"}`;
  return `${head}${SEPARATOR}${count}`;
}

/** "proj-a (3) · proj-b (1) · +2" — first line, aggregate mode. */
function formatProjectLine(projects: ProjectActivity[]): string {
  const labels = projects.map((p) => `${p.name} (${p.features.length})`);
  return joinWithOverflow(labels);
}

/** "🌐 3 projects · 8 features" — second line, aggregate mode. */
function formatAggregateState(projects: ProjectActivity[]): string {
  const totalFeatures = projects.reduce((sum, p) => sum + p.features.length, 0);
  const projWord = projects.length === 1 ? "project" : "projects";
  const featWord = totalFeatures === 1 ? "feature" : "features";
  return `🌐 ${projects.length} ${projWord}${SEPARATOR}${totalFeatures} ${featWord}`;
}

/**
 * Join with " · " and surface the overflow as "· +N". Always keeps at least
 * one name visible — if the first one already exceeds the budget we hard-
 * truncate with an ellipsis so the line still says something.
 */
function joinWithOverflow(items: string[]): string {
  let acc = "";
  let kept = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const sep = kept === 0 ? "" : SEPARATOR;
    const tentative = acc + sep + item;
    const remaining = items.length - i - 1;
    const suffix = remaining > 0 ? `${SEPARATOR}+${remaining}` : "";
    if ((tentative + suffix).length > DETAILS_MAX) break;
    acc = tentative;
    kept = i + 1;
  }

  if (kept === 0) {
    return items[0]!.slice(0, DETAILS_MAX - 1) + "…";
  }

  const omitted = items.length - kept;
  return omitted > 0 ? `${acc}${SEPARATOR}+${omitted}` : acc;
}
