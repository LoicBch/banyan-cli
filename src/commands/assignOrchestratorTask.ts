/**
 * Send a follow-up prompt to the project's orchestrator pane.
 *
 * The orchestrator runs in the `workspace` window's left pane (created by
 * `bn <project> start`) and is tagged `@banyan-pane = "orchestrator"`.
 * Companion to `assignTask` (which targets per-feature panes) — used by
 * the dashboard's "Talk to orchestrator" chat box.
 *
 * `delegate` mode wraps the user's text with a directive that forces
 * the orchestrator into pure coordinator behaviour (decompose + spawn
 * sub-features, no direct code work). Without the flag the orchestrator
 * stays permissive — same vibe as a normal tmux-pane conversation.
 */
import type { Config } from "../config.js";
import { getProject } from "../config.js";
import * as tmux from "../tmux.js";
import * as naming from "../naming.js";
import { UsageError, BanyanError } from "../errors.js";

const WORKSPACE_WINDOW = "workspace";
const ORCHESTRATOR_TAG = "orchestrator";

const DELEGATION_DIRECTIVE = `[delegation request] The following is a delegation task. Decompose it into one or more concrete sub-features and spawn each via banyan_create_feature with mode="delegated" by default. Do NOT implement any code yourself in this turn — your role here is pure coordination. List the planned features back to the user before / as you spawn them.

Task:
`;

export interface AssignOrchestratorTaskOpts {
  /** Wrap the prompt with a directive that puts the orchestrator into
   *  strict coordinator mode (decompose into sub-features, no inline
   *  code work). Default: false — orchestrator stays permissive. */
  delegate?: boolean;
  /** Send the prompt even if Claude isn't detected in the pane. */
  force?: boolean;
}

export async function assignOrchestratorTask(
  config: Config,
  projectName: string,
  prompt: string,
  opts: AssignOrchestratorTaskOpts = {},
): Promise<{ paneId: string }> {
  if (!prompt.trim()) {
    throw new UsageError("prompt cannot be empty");
  }
  // Validate the project resolves (throws if unknown).
  getProject(config, projectName);

  const session = naming.sessionName(projectName);
  if (!(await tmux.hasSession(session))) {
    throw new BanyanError(
      `tmux session '${session}' is not running — start the workspace first: bn ${projectName} start`,
    );
  }
  if (!(await tmux.windowExists(session, WORKSPACE_WINDOW))) {
    throw new BanyanError(
      `workspace window not found in ${session} — start the workspace first: bn ${projectName} start`,
    );
  }

  const paneId = await tmux.findPaneByUserOption(
    session,
    WORKSPACE_WINDOW,
    "@banyan-pane",
    ORCHESTRATOR_TAG,
  );
  if (!paneId) {
    throw new BanyanError(
      `orchestrator pane not found in ${session}:${WORKSPACE_WINDOW} — try \`bn ${projectName} restart-orchestrator\``,
    );
  }

  if (!opts.force && !(await tmux.isClaudeRunning(paneId))) {
    throw new BanyanError(
      `orchestrator pane is not running claude (the prompt would land in a shell). retry once claude has started, or pass force to send anyway`,
    );
  }

  const finalText = opts.delegate
    ? `${DELEGATION_DIRECTIVE}${prompt.trim()}`
    : prompt.trim();
  await tmux.pasteText(paneId, finalText, { submit: true });
  return { paneId };
}
