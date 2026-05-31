/**
 * Discord RPC client wrapper.
 *
 * Manages connection to Discord and activity updates.
 */
import { Client as DiscordRPC } from "@xhayper/discord-rpc";
import type { DiscordRpcConfig, BanyanActivity } from "./config.js";
import { buildActivity } from "./activity.js";

export class DiscordRpcClient {
  private client: DiscordRPC;
  private config: DiscordRpcConfig;
  private connected = false;
  private reconnectTimer?: NodeJS.Timeout;
  private updateTimer?: NodeJS.Timeout;

  constructor(config: DiscordRpcConfig) {
    this.config = config;
    this.client = new DiscordRPC({
      clientId: config.applicationId || "1234567890123456789",
    });

    this.client.on("ready", () => {
      console.log("[discord-rpc] Connected to Discord");
      this.connected = true;
    });

    this.client.on("disconnected", () => {
      console.log("[discord-rpc] Disconnected from Discord");
      this.connected = false;
      this.scheduleReconnect();
    });
  }

  /**
   * Connect to Discord and start updating activity.
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      await this.client.login();
    } catch (err) {
      console.error("[discord-rpc] Failed to connect:", (err as Error).message);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect and cleanup.
   */
  async stop(): Promise<void> {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.connected) {
      try {
        await this.client.user?.clearActivity();
        await this.client.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }

    this.connected = false;
  }

  /**
   * Update activity on Discord.
   */
  async updateActivity(activity: BanyanActivity): Promise<void> {
    if (!this.connected || !this.config.enabled) {
      return;
    }

    const discordActivity = buildActivity(activity, this.config);

    try {
      if (discordActivity) {
        await this.client.user?.setActivity(discordActivity);
      } else {
        // No activity to show, clear it
        await this.client.user?.clearActivity();
      }
    } catch (err) {
      console.error("[discord-rpc] Failed to update activity:", (err as Error).message);
    }
  }

  /**
   * Schedule periodic updates.
   */
  startPeriodicUpdates(getActivity: () => Promise<BanyanActivity>): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }

    const intervalMs = (this.config.updateIntervalSec || 15) * 1000;

    this.updateTimer = setInterval(async () => {
      if (this.connected) {
        try {
          const activity = await getActivity();
          await this.updateActivity(activity);
        } catch (err) {
          console.error("[discord-rpc] Failed to get activity:", (err as Error).message);
        }
      }
    }, intervalMs);
  }

  /**
   * Schedule reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.start().catch(() => {
        // Will retry again via scheduleReconnect on failure
      });
    }, 30000); // Retry every 30s
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.connected;
  }
}
