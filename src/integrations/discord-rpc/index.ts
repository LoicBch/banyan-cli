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
 * Configuration in ~/.config/banyan/discord-rpc.yaml:
 * ```yaml
 * enabled: true
 * updateIntervalSec: 15
 * ```
 */

import type { Config } from "../../config.js";
import { DiscordRpcClient } from "./client.js";
import type { DiscordRpcConfig, BanyanActivity } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";

export type { DiscordRpcConfig, BanyanActivity, ProjectActivity } from "./config.js";

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
 * Stub helper kept for compatibility with older imports. Real activity
 * data comes from `stateReader.readBanyanActivity()` — this just returns
 * an idle snapshot so callers that haven't migrated yet still type-check.
 */
export async function buildBanyanActivity(
  _config: Config,
  dashboardUrl?: string,
): Promise<BanyanActivity> {
  return {
    projects: [],
    startTime: new Date().toISOString(),
    dashboardUrl,
  };
}
