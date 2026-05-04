/**
 * Shared helpers for spawning Claude with banyan-aware context.
 *
 * Both the orchestrator (interactive, tmux pane) and the headless conflict
 * resolver (one-shot, `claude -p` subprocess) need:
 *   1. Read access to every repo's parent dir, so they can see sibling
 *      worktrees of OTHER features (cross-feature awareness).
 *   2. The banyan MCP server wired in, so they can call banyan_list_features,
 *      banyan_feature_status, etc.
 *
 * These helpers centralise the config/path generation.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ProjectConfig } from "./config.js";

const BANYAN_DIR = path.join(homedir(), ".config", "banyan");
const MCP_CONFIG_PATH = path.join(BANYAN_DIR, "orchestrator-mcp.json");

/**
 * Ensure ~/.config/banyan/orchestrator-mcp.json exists and points at
 * `banyan mcp-serve`. Idempotent. Returns the absolute path.
 */
export function ensureBanyanMcpConfig(): string {
  mkdirSync(BANYAN_DIR, { recursive: true });
  const cfg = {
    mcpServers: {
      banyan: {
        command: "banyan",
        args: ["mcp-serve"],
      },
    },
  };
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  return MCP_CONFIG_PATH;
}

/**
 * Unique parent directories of every non-compose repo in a project. Used as
 * `--add-dir` so a Claude session sees current AND future feature worktrees
 * (which banyan creates as siblings: `<repo>-<feature>`).
 */
export function projectParentDirs(project: ProjectConfig): string[] {
  const seen = new Set<string>();
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    seen.add(path.dirname(repo.path));
  }
  return [...seen];
}
