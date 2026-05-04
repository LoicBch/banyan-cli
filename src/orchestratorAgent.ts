/**
 * Shared logic for building & launching the banyan orchestrator agent.
 *
 * Used by:
 *   - `bn <project> start` (workspace layout: orchestrator pane + terminal pane)
 *   - `bn <project> orchestrator` (dedicated orchestrator-<project> window)
 *
 * Both paths spawn the same Claude session (same MCP config, same --add-dir
 * scope, same --continue marker, same system prompt) — they only differ in
 * the tmux window/pane layout. Centralising here keeps the two in sync and
 * removes the need for a per-project bash workspace script.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ProjectConfig } from "./config.js";
import * as git from "./git.js";
import * as naming from "./naming.js";
import {
  ensureBanyanMcpConfig,
  projectParentDirs,
} from "./claudeContext.js";
import { shellQuote } from "./shell.js";

const BANYAN_DIR = path.join(homedir(), ".config", "banyan");

export function orchestratorMarkerPath(projectName: string): string {
  return path.join(BANYAN_DIR, `${projectName}.orchestrator.session`);
}

export function hasOrchestratorMarker(projectName: string): boolean {
  return existsSync(orchestratorMarkerPath(projectName));
}

export function recordOrchestratorMarker(projectName: string): void {
  mkdirSync(BANYAN_DIR, { recursive: true });
  writeFileSync(
    orchestratorMarkerPath(projectName),
    new Date().toISOString(),
    "utf8",
  );
}

export function readOrchestratorMarker(projectName: string): string | undefined {
  const p = orchestratorMarkerPath(projectName);
  if (!existsSync(p)) return undefined;
  try {
    return readFileSync(p, "utf8").trim();
  } catch {
    return undefined;
  }
}

export function clearOrchestratorMarker(projectName: string): void {
  const p = orchestratorMarkerPath(projectName);
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      // ignore
    }
  }
}

/**
 * Static description of the orchestrator's role + tools. Concatenated with a
 * live feature inventory in `buildSystemPrompt` below.
 */
function staticSystemPrompt(projectName: string): string {
  return [
    `You are the orchestrator agent for the banyan project "${projectName}".`,
    ``,
    `Scope:`,
    `- Multiple parallel features are being developed in this project. Each runs`,
    `  in its own git worktree, with its own per-feature Claude agent in a`,
    `  separate tmux pane (window 'agents-${projectName}').`,
    `- You have read access to the parent directory of every repo, so you can`,
    `  see all current and future feature worktrees.`,
    `- You have the banyan MCP tools available (banyan_list_features,`,
    `  banyan_feature_status, banyan_get_stack_ports, banyan_create_feature,`,
    `  banyan_merge_feature, banyan_cleanup_feature, ...). Use them to read`,
    `  state and act on the project.`,
    ``,
    `Use yourself for:`,
    `- Cross-feature awareness: detect when two in-flight features will likely`,
    `  conflict at merge, and explain why before any merge is attempted.`,
    `- Strategic ordering: recommend a merge order that minimises rebase pain.`,
    `- Project-level housekeeping: clean up stale features, dump prod, recreate`,
    `  stacks, etc.`,
    `- Driving the merge yourself when asked: call banyan_merge_feature with`,
    `  autoResolve=true. The headless resolver it spawns already has the same`,
    `  cross-feature context you do (parent dirs + banyan MCP), so it handles`,
    `  routine conflicts on its own. Step in only if it gives up.`,
    ``,
    `Don't:`,
    `- Replace the per-feature agents. Their pane is the right place for`,
    `  feature-specific implementation.`,
    `- Push without explicit user direction. Use the merge tools when asked.`,
  ].join("\n");
}

/**
 * Inventory of currently-active features, derived from `git worktree list` on
 * each repo of the project. Returns "" if it can't be computed (errors are
 * swallowed — the static prompt is still useful without it).
 */
async function buildFeatureInventory(project: ProjectConfig): Promise<string> {
  const featureMap = new Map<string, string[]>();
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    const wts = await git.worktreeList(repo.path).catch(() => []);
    for (const wt of wts) {
      if (wt.path === repo.path) continue;
      const parsed = naming.parseWorktreePath(wt.path, repo.path);
      if (!parsed) continue;
      const list = featureMap.get(parsed.feature) ?? [];
      list.push(repo.name);
      featureMap.set(parsed.feature, list);
    }
  }
  if (featureMap.size === 0) {
    return "\n\nNo features active yet. Suggest banyan_create_feature to start one.";
  }
  const lines = ["", "Current features:"];
  for (const [feat, repos] of featureMap.entries()) {
    lines.push(`  - ${feat}  (repos: ${repos.join(", ")})`);
  }
  return "\n" + lines.join("\n");
}

export async function buildSystemPrompt(project: ProjectConfig): Promise<string> {
  return staticSystemPrompt(project.name) + (await buildFeatureInventory(project));
}

/**
 * Build the full `claude ...` command string used to launch the orchestrator
 * in any tmux pane. Records the marker so the next call resumes via
 * `--continue`.
 */
export async function buildOrchestratorClaudeCommand(
  project: ProjectConfig,
): Promise<{ command: string; parentDirs: string[]; mcpConfig: string }> {
  const parentDirs = projectParentDirs(project);
  const mcpConfig = ensureBanyanMcpConfig();
  const systemPrompt = await buildSystemPrompt(project);

  const addDirArgs = parentDirs.map(shellQuote).join(" ");
  const argsTail =
    `--mcp-config ${shellQuote(mcpConfig)} ` +
    `--add-dir ${addDirArgs} ` +
    `--append-system-prompt ${shellQuote(systemPrompt)}`;

  // Try to resume a prior orchestrator session via `--continue`; if no
  // session exists for this cwd (e.g. fresh project, marker stale, or user
  // deleted ~/.claude), fall back to a fresh session via the shell `||`
  // chain. The marker is still useful as a signal for `bn orchestrator
  // status`, but we no longer rely on it as the sole gate.
  const resumeAttempt = hasOrchestratorMarker(project.name)
    ? `claude --continue ${argsTail} 2>/dev/null || `
    : "";
  const command = `${resumeAttempt}claude ${argsTail}`;

  // Mark this run so the next call sees the marker and tries --continue.
  // The shell fallback above means a stale/missing session no longer breaks
  // the launch — the user just gets a fresh conversation.
  recordOrchestratorMarker(project.name);

  return { command, parentDirs, mcpConfig };
}
