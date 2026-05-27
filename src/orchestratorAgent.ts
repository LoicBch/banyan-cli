/**
 * Shared logic for building & launching the banyan orchestrator agent.
 *
 * Used by `bn <project> start` to spawn the orchestrator pane in the
 * workspace tmux window (next to a free terminal pane). The same claude
 * session is resumed across restarts via the marker file.
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
import {
  ensureBanyanMcpConfig,
  projectParentDirs,
} from "./claudeContext.js";
import { writeLaunchScript } from "./claude.js";
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
    `Feature inventory — ALWAYS dynamic:`,
    `- DO NOT rely on any feature list cached in your context. Features are`,
    `  created, cleaned up, and renamed between turns (and across sessions`,
    `  resumed via --continue). What you remember from earlier is stale.`,
    `- ALWAYS call banyan_list_features as your first action when:`,
    `    · the user asks anything about project state or active features,`,
    `    · you're about to call banyan_create_feature (to confirm the name`,
    `      is free + check for related work that may conflict),`,
    `    · you're about to call banyan_merge_feature / banyan_cleanup_feature`,
    `      (confirm the feature actually exists right now),`,
    `    · you're resuming after any wait, or it's the first message of a`,
    `      session.`,
    `- The tool is cheap. Re-listing on every turn is fine. Acting on stale`,
    `  state is not.`,
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

export async function buildSystemPrompt(project: ProjectConfig): Promise<string> {
  // The feature inventory is INTENTIONALLY not injected here. A snapshot
  // baked into the system prompt rapidly goes stale (features are
  // created/cleaned/renamed mid-session, and the same prompt is reused on
  // every --continue restart). The orchestrator is instructed to always
  // call banyan_list_features for the live view.
  return staticSystemPrompt(project.name);
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
  const mcpConfig = ensureBanyanMcpConfig("orchestrator");
  const systemPrompt = await buildSystemPrompt(project);

  // Stash the system prompt on disk and have the shell substitute it via
  // `$(cat …)` instead of inlining the multi-thousand-character literal.
  // Without this the pane history shows pages of `cmdor quote>` zsh
  // continuation prompts while the command is being typed.
  const stateDir = path.join(homedir(), ".config", "banyan", "state");
  mkdirSync(stateDir, { recursive: true });
  const promptPath = path.join(stateDir, `${project.name}.orchestrator.prompt.md`);
  writeFileSync(promptPath, systemPrompt, "utf8");

  const addDirArgs = parentDirs.map(shellQuote).join(" ");
  const argsTail =
    `--mcp-config ${shellQuote(mcpConfig)} ` +
    `--add-dir ${addDirArgs} ` +
    `--append-system-prompt "$(cat ${shellQuote(promptPath)})"`;

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

  // Hide the verbose invocation behind a launch script so the workspace pane
  // doesn't show 500+ chars of --add-dir / --mcp-config / $(cat …) before
  // claude takes over. The script body holds the real command; the pane only
  // sees `clear && bash <script>`.
  const launchScript = path.join(stateDir, `${project.name}.orchestrator.launch.sh`);
  writeLaunchScript(launchScript, command);
  const hiddenCommand = `clear && bash ${shellQuote(launchScript)}`;

  return { command: hiddenCommand, parentDirs, mcpConfig };
}
