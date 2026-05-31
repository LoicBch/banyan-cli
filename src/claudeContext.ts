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

/**
 * Scope of the MCP server spawned by a caller. The MCP server filters its
 * registered tools by this scope at boot, so we can hand each surface only
 * the tools it actually uses:
 *   - orchestrator: every tool (~21k tokens of definitions)
 *   - feature: just what a per-feature agent calls (~3-4k tokens)
 *   - resolver: just cross-feature awareness (~1-2k tokens)
 * Omit for the legacy "everything" behaviour (orchestrator default).
 */
export type McpScope = "orchestrator" | "feature" | "resolver";

/**
 * Ensure ~/.config/banyan/<scope>-mcp.json exists and points at
 * `banyan mcp-serve --scope <scope>` (or no scope for the unscoped default).
 * Idempotent. Returns the absolute path.
 */
export function ensureBanyanMcpConfig(scope?: McpScope): string {
  mkdirSync(BANYAN_DIR, { recursive: true });
  const name = scope ?? "orchestrator";
  const configPath = path.join(BANYAN_DIR, `${name}-mcp.json`);
  const args = scope ? ["mcp-serve", "--scope", scope] : ["mcp-serve"];
  const cfg = {
    mcpServers: {
      banyan: { command: "banyan", args },
    },
  };
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
  return configPath;
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
