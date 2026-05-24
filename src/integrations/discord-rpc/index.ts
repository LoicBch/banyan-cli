/**
 * Discord Rich Presence integration for Banyan.
 *
 * This module is completely optional and separated from main Banyan logic.
 * It displays your current Banyan activity in your Discord profile.
 *
 * Usage:
 * 1. Enable in config: `discordRpc: { enabled: true }`
 * 2. The service will auto-connect when the dashboard starts
 * 3. Activity updates every 15 seconds (configurable)
 *
 * Configuration in ~/.config/banyan/config.yaml:
 * ```yaml
 * discordRpc:
 *   enabled: true
 *   updateIntervalSec: 15
 *   showProject: true
 *   showFeatureCount: true
 *   showMode: true
 * ```
 */

import type { Config } from "../../config.js";
import { DiscordRpcClient } from "./client.js";
import type { DiscordRpcConfig, BanyanActivity } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";

export type { DiscordRpcConfig, BanyanActivity } from "./config.js";

/**
 * Discord RPC service singleton.
 */
export class DiscordRpcService {
  private static instance?: DiscordRpcService;
  private client?: DiscordRpcClient;
  private config: DiscordRpcConfig;

  private constructor(config: DiscordRpcConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Get or create the Discord RPC service instance.
   */
  static getInstance(config?: DiscordRpcConfig): DiscordRpcService {
    if (!DiscordRpcService.instance) {
      DiscordRpcService.instance = new DiscordRpcService(config || DEFAULT_CONFIG);
    }
    return DiscordRpcService.instance;
  }

  /**
   * Start the Discord RPC client if enabled.
   */
  async start(getActivity: () => Promise<BanyanActivity>): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    if (this.client) {
      // Already started
      return;
    }

    this.client = new DiscordRpcClient(this.config);
    await this.client.start();

    // Start periodic updates
    this.client.startPeriodicUpdates(getActivity);

    // Initial update
    const activity = await getActivity();
    await this.client.updateActivity(activity);
  }

  /**
   * Stop the Discord RPC client.
   */
  async stop(): Promise<void> {
    if (this.client) {
      await this.client.stop();
      this.client = undefined;
    }
  }

  /**
   * Check if the service is enabled and connected.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  isConnected(): boolean {
    return this.client?.isConnected() ?? false;
  }

  /**
   * Update configuration at runtime.
   */
  updateConfig(config: Partial<DiscordRpcConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Build a BanyanActivity from Banyan config and dashboard state.
 * This is a helper for the dashboard to easily build activity.
 */
export async function buildBanyanActivity(
  config: Config,
  dashboardUrl?: string,
): Promise<BanyanActivity> {
  // This will be populated by reading the actual state
  // For now, we'll create a simple implementation
  const features: string[] = [];
  const modes: Record<string, string> = {};

  // Note: The dashboard will need to provide the actual state
  // This is just a placeholder structure

  return {
    project: config.projects[0]?.name,
    features,
    modes,
    startTime: new Date().toISOString(),
    dashboardUrl,
  };
}
