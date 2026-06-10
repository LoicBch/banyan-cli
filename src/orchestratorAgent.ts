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
    `- The \`mode\` parameter on banyan_create_feature has two values, which`,
    `  map to two banyan usage patterns. Listen to what the user says about`,
    `  each task and pick the right one:`,
    `    live      — user said "I'll work on this with the agent" / "let me`,
    `      drive" / "I want to be there" / "manuel" / "ask me along the way".`,
    `      Banyan-aware claude, conversational, no ceremony — no plan-review,`,
    `      no Stop-hook loop, no report obligation. The user is sitting in`,
    `      front of the agent's pane and pair-codes with it.`,
    `    delegated — DEFAULT. user said "do it" / "fais-le" / "let it run" /`,
    `      "I trust it" / "fais une todo et finis tout" / "tâche routinière".`,
    `      Pipeline-gated: agent submits a plan for review (banyan_set_todo +`,
    `      banyan_request_plan_approval), waits for approval, then executes`,
    `      under a Stop hook that keeps it looping until every TODO item is`,
    `      done AND banyan_report_done has been called. The user reviews the`,
    `      plan + final report from the dashboard rather than watching live.`,
    `- When in doubt between live and delegated: ask the user briefly`,
    `  (one-line clarification), don't guess silently. The two modes have`,
    `  very different ergonomics and aren't switchable mid-stream.`,
    `- The user can override with explicit phrasing like "mode delegated"`,
    `  or "mode live" — that always wins.`,
    `- Legacy mode names (interactive/assisted/autonomous/autopilot) are`,
    `  accepted on input and normalized: interactive+assisted → live,`,
    `  autonomous+autopilot → delegated. Prefer the new names in your own`,
    `  utterances so the user learns the current vocabulary.`,
    ``,
    `Plan-review gate:`,
    `- Delegated mode bakes plan-review in by default — no extra parameter`,
    `  needed. The sub-agent will set up its TODO, call`,
    `  banyan_request_plan_approval, and wait. The user approves via the`,
    `  dashboard's "Review plan" button (or, if delegated to you,`,
    `  banyan_approve_plan / banyan_reject_plan).`,
    `- For live mode features, plan-review is OFF by default. Pass`,
    `  requireApproval=true if the user explicitly asked to validate the`,
    `  plan before work starts on a live feature (rare).`,
    `- If the user wants plan-review on every task this session, default`,
    `  to mode=delegated on each banyan_create_feature — it's the natural`,
    `  fit.`,
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
