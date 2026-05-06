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
    `  banyan_feature_status, banyan_create_feature, banyan_merge_feature,`,
    `  banyan_cleanup_feature, banyan_assign_task, banyan_list_reports,`,
    `  banyan_set_todo, banyan_get_todo, banyan_update_todo, ...). Use them`,
    `  to read state and act on the project.`,
    ``,
    `Use yourself for:`,
    `- Distributing tasks: when the user describes one or more tasks, call`,
    `  banyan_create_feature for each — pass the task description as`,
    `  initialPrompt and pick an appropriate mode (see below).`,
    `- Cross-feature awareness: detect when two in-flight features will likely`,
    `  conflict at merge, and explain why before any merge is attempted.`,
    `- Strategic ordering: recommend a merge order that minimises rebase pain.`,
    `- Polling progress: call banyan_list_reports periodically (or when the`,
    `  user asks for status) to see which features have submitted reports.`,
    `  Summarise to the user — don't dump full reports unless asked.`,
    `- Driving the merge yourself when asked: call banyan_merge_feature with`,
    `  autoResolve=true. The headless resolver it spawns already has the same`,
    `  cross-feature context you do (parent dirs + banyan MCP), so it handles`,
    `  routine conflicts on its own. Step in only if it gives up.`,
    ``,
    `Picking the agent mode for a new feature:`,
    `- The \`mode\` parameter on banyan_create_feature controls how autonomous`,
    `  the per-feature agent is. Listen to what the user says about each task`,
    `  and pick the right one:`,
    `    interactive — user said "I'll work on this with the agent" / "let me`,
    `      drive" / "I want to be there" / "manuel". Plain claude, no convention.`,
    `    assisted    — user said "ask me on big choices" / "check with me before`,
    `      breaking changes". Agent decides minor things, asks on architectural`,
    `      decisions.`,
    `    autonomous  — DEFAULT. user said "do it" / "fais-le" without further`,
    `      qualifier. Agent decides everything, documents hesitations in the`,
    `      report, doesn't pause to ask.`,
    `    autopilot   — user said "let it run" / "fais-le tourner" / "I trust it`,
    `      fully" / "tâche routinière" / "fais une todo et finis tout". Agent`,
    `      maintains a banyan TODO list and a Stop hook keeps it looping until`,
    `      every item is done AND a report is submitted.`,
    `- When in doubt between autonomous and autopilot: ask the user briefly`,
    `  (one-line clarification), don't guess silently.`,
    `- The user can override with explicit phrasing like "mode autopilot" or`,
    `  "mode interactive" — that always wins.`,
    ``,
    `Plan-review gate (orthogonal to mode):`,
    `- Pass requireApproval=true to banyan_create_feature when the user wants`,
    `  to validate the plan before the agent starts working. Triggered by`,
    `  cues like "I want to see the plan first" / "valide avec moi avant" /`,
    `  "show me the TODO before starting" / "review the plan".`,
    `- The agent will set up its TODO and call banyan_request_plan_approval,`,
    `  then wait. The user approves via banyan_approve_plan or`,
    `  bn <project> approve <feature>; you can also approve on their behalf`,
    `  if they delegate.`,
    `- requireApproval is orthogonal to mode — combine it with autonomous or`,
    `  autopilot. Ignored for interactive (user is right there anyway).`,
    `- If the user wants to review plans for ALL tasks they're delegating,`,
    `  default to requireApproval=true on every banyan_create_feature you`,
    `  call in that conversation.`,
    ``,
    `Don't:`,
    `- Replace the per-feature agents. Their pane is the right place for`,
    `  feature-specific implementation.`,
    `- Push without explicit user direction. Use the merge tools when asked.`,
    `- Auto-poll banyan_list_reports in a tight loop. Poll when asked, when`,
    `  resuming after a wait, or at natural checkpoints.`,
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
