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
  /** Show project name in activity (default: true). */
  showProject?: boolean;
  /** Show feature count (default: true). */
  showFeatureCount?: boolean;
  /** Show active mode (default: true). */
  showMode?: boolean;
  /** Large image key (default: "banyan"). */
  largeImageKey?: string;
  /** Large image text (default: "Banyan"). */
  largeImageText?: string;
}

export interface BanyanActivity {
  /** Current project name. */
  project?: string;
  /** Active features. */
  features: string[];
  /** Agent modes per feature. */
  modes: Record<string, string>;
  /** Session start time (ISO timestamp). */
  startTime?: string;
  /** Dashboard URL. */
  dashboardUrl?: string;
}

export const DEFAULT_CONFIG: Required<DiscordRpcConfig> = {
  enabled: false,
  applicationId: "1234567890123456789", // Will be replaced with actual Banyan Discord App ID
  updateIntervalSec: 15,
  showProject: true,
  showFeatureCount: true,
  showMode: true,
  largeImageKey: "banyan",
  largeImageText: "Banyan",
};
