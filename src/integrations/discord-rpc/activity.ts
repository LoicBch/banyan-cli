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

  // Always lead with the global counts (features · projects) — it's the
  // glanceable "how busy" signal. The state line carries the project
  // names so a curious viewer can see what's running.
  result.details = formatTotals(activity.projects);
  const stateLine = formatProjectList(activity.projects);
  if (stateLine.length > 0) result.state = stateLine;

  if (activity.startTime) {
    const ts = new Date(activity.startTime).getTime();
    if (!Number.isNaN(ts)) result.startTimestamp = Math.floor(ts / 1000);
  }

  if (activity.dashboardUrl && /^https:\/\//.test(activity.dashboardUrl)) {
    result.buttons = [{ label: "Open Dashboard", url: activity.dashboardUrl }];
  }

  return result;
}

/** "5 features · 3 projects" — globally aggregated totals, always the
 *  prominent first line. Pluralizes correctly for 1. */
function formatTotals(projects: ProjectActivity[]): string {
  const totalFeatures = projects.reduce((sum, p) => sum + p.features.length, 0);
  const projWord = projects.length === 1 ? "project" : "projects";
  const featWord = totalFeatures === 1 ? "feature" : "features";
  return `${totalFeatures} ${featWord}${SEPARATOR}${projects.length} ${projWord}`;
}

/** "proj-a · proj-b · proj-c · +N" — list of active project names on
 *  the state line. Truncates with an overflow marker. */
function formatProjectList(projects: ProjectActivity[]): string {
  const names = projects.map((p) => p.name);
  return joinWithOverflow(names);
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
