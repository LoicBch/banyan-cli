/**
 * Load Discord RPC configuration from ~/.config/banyan/discord-rpc.yaml
 *
 * This is completely separate from the main Banyan config to keep things clean.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import type { DiscordRpcConfig } from "./config.js";
import { DEFAULT_CONFIG } from "./config.js";

const CONFIG_DIR = path.join(homedir(), ".config", "banyan");
const CONFIG_PATH = path.join(CONFIG_DIR, "discord-rpc.yaml");

/**
 * Load Discord RPC config. Returns default (disabled) if file doesn't exist.
 * Legacy display toggles (showProject / showFeatureCount / showMode) are
 * silently ignored — the layout is now fixed by design.
 */
export function loadDiscordRpcConfig(): DiscordRpcConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = YAML.parse(readFileSync(CONFIG_PATH, "utf8"));
    if (!raw || typeof raw !== "object") {
      return { ...DEFAULT_CONFIG };
    }

    return {
      ...DEFAULT_CONFIG,
      ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
      ...(typeof raw.applicationId === "string" ? { applicationId: raw.applicationId } : {}),
      ...(typeof raw.updateIntervalSec === "number" ? { updateIntervalSec: raw.updateIntervalSec } : {}),
      ...(typeof raw.largeImageKey === "string" ? { largeImageKey: raw.largeImageKey } : {}),
      ...(typeof raw.largeImageText === "string" ? { largeImageText: raw.largeImageText } : {}),
      ...(typeof raw.smallImageKey === "string" ? { smallImageKey: raw.smallImageKey } : {}),
      ...(typeof raw.smallImageText === "string" ? { smallImageText: raw.smallImageText } : {}),
    };
  } catch (err) {
    console.error(`[discord-rpc] Failed to load config: ${(err as Error).message}`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save Discord RPC config.
 */
export function saveDiscordRpcConfig(config: DiscordRpcConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });

  const data = {
    enabled: config.enabled,
    ...(config.applicationId !== DEFAULT_CONFIG.applicationId ? { applicationId: config.applicationId } : {}),
    ...(config.updateIntervalSec !== DEFAULT_CONFIG.updateIntervalSec ? { updateIntervalSec: config.updateIntervalSec } : {}),
    ...(config.largeImageKey !== DEFAULT_CONFIG.largeImageKey ? { largeImageKey: config.largeImageKey } : {}),
    ...(config.largeImageText !== DEFAULT_CONFIG.largeImageText ? { largeImageText: config.largeImageText } : {}),
    ...(config.smallImageKey !== DEFAULT_CONFIG.smallImageKey ? { smallImageKey: config.smallImageKey } : {}),
    ...(config.smallImageText !== DEFAULT_CONFIG.smallImageText ? { smallImageText: config.smallImageText } : {}),
  };

  const header = `# Banyan Discord Rich Presence Configuration
# This integration is completely optional and displays your Banyan activity
# in your Discord profile.
#
# To enable:
# 1. Set enabled: true
# 2. Restart the dashboard (bn serve)
# 3. Make sure Discord desktop is running
#
# Layout (fixed by design):
#   single project   →  features on top line, project name below
#   multiple projects →  projects with feature counts on top line, totals below

`;

  writeFileSync(CONFIG_PATH, header + YAML.stringify(data), "utf8");
}

/**
 * Create a starter config file.
 */
export function writeStarterDiscordRpcConfig(): string {
  mkdirSync(CONFIG_DIR, { recursive: true });

  const starter = `# Banyan Discord Rich Presence Configuration
# This integration is completely optional and displays your Banyan activity
# in your Discord profile.

# Enable Discord Rich Presence (default: false)
enabled: false

# Update interval in seconds (default: 15)
updateIntervalSec: 15

# Advanced — assets must be uploaded on the Discord Developer Portal under
# this application id. Defaults reference Banyan's official assets.
# largeImageKey: "banyan-logo"
# largeImageText: "Banyan — multi-agent worktree orchestrator"
# smallImageKey: "status-working"
# smallImageText: "Working"
# applicationId: "1508879085680595004"
`;

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, starter, "utf8");
  }

  return CONFIG_PATH;
}

/**
 * Get the config file path.
 */
export function discordRpcConfigPath(): string {
  return CONFIG_PATH;
}
