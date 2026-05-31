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
      ...(typeof raw.showProject === "boolean" ? { showProject: raw.showProject } : {}),
      ...(typeof raw.showFeatureCount === "boolean" ? { showFeatureCount: raw.showFeatureCount } : {}),
      ...(typeof raw.showMode === "boolean" ? { showMode: raw.showMode } : {}),
      ...(typeof raw.largeImageKey === "string" ? { largeImageKey: raw.largeImageKey } : {}),
      ...(typeof raw.largeImageText === "string" ? { largeImageText: raw.largeImageText } : {}),
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
    ...(config.showProject !== DEFAULT_CONFIG.showProject ? { showProject: config.showProject } : {}),
    ...(config.showFeatureCount !== DEFAULT_CONFIG.showFeatureCount ? { showFeatureCount: config.showFeatureCount } : {}),
    ...(config.showMode !== DEFAULT_CONFIG.showMode ? { showMode: config.showMode } : {}),
    ...(config.largeImageKey !== DEFAULT_CONFIG.largeImageKey ? { largeImageKey: config.largeImageKey } : {}),
    ...(config.largeImageText !== DEFAULT_CONFIG.largeImageText ? { largeImageText: config.largeImageText } : {}),
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
# Your Discord profile will show:
# - Current project name
# - Number of active features
# - Agent mode (autonomous, assisted, etc.)
# - Link to your Banyan dashboard

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

# Display options
showProject: true       # Show project name
showFeatureCount: true  # Show number of active features
showMode: true          # Show agent mode (autonomous, assisted, etc.)

# Advanced options (usually don't need to change these)
# applicationId: "1234567890123456789"  # Custom Discord Application ID
# largeImageKey: "banyan"
# largeImageText: "Banyan"
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
