/**
 * Discord RPC configuration and types.
 *
 * This module is completely optional and separated from the main Banyan logic.
 * When enabled, it displays your Banyan activity in your Discord profile.
 */

export interface DiscordRpcConfig {
  /** Enable Discord Rich Presence (default: false). */
  enabled: boolean;
  /** Discord Application ID (uses Banyan's default if not provided). */
  applicationId?: string;
  /** Update interval in seconds (default: 15). */
  updateIntervalSec?: number;
  /** Large image asset key. Must match an asset uploaded to the Discord
   *  Developer Portal for this application — Discord silently rejects
   *  activities that reference unknown keys. */
  largeImageKey?: string;
  /** Tooltip shown when hovering the large image. */
  largeImageText?: string;
  /** Small image badge overlaid on the large image. Same caveat re:
   *  unknown keys. */
  smallImageKey?: string;
  /** Tooltip for the small badge. */
  smallImageText?: string;
}

/** One active project's snapshot for the Discord card. */
export interface ProjectActivity {
  /** Project name as configured in banyan. */
  name: string;
  /** Feature names that have a live agent pane right now. */
  features: string[];
  /** Total worktrees that exist for the project (active or not). */
  totalWorktrees: number;
}

export interface BanyanActivity {
  /** All projects with at least one running session. Empty = idle. */
  projects: ProjectActivity[];
  /** Service start time (used for the elapsed timer). */
  startTime?: string;
  /** Public dashboard URL (https only — Discord refuses http/localhost). */
  dashboardUrl?: string;
}

export const DEFAULT_CONFIG: Required<DiscordRpcConfig> = {
  enabled: false,
  applicationId: "1508879085680595004", // Banyan's official Discord application
  updateIntervalSec: 15,
  // Asset keys must match PNGs uploaded to the Discord Developer Portal
  // under the application id above. SVG masters live in assets/discord/.
  largeImageKey: "banyan-logo",
  largeImageText: "Banyan — multi-agent worktree orchestrator",
  smallImageKey: "status-working",
  smallImageText: "Working",
};
