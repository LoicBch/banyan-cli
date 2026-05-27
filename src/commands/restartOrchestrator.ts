/**
 * `bn <project> restart-orchestrator` — respawn just the orchestrator pane.
 *
 * Use when the orchestrator's claude process exited or got replaced (e.g.
 * the user quit claude inside the pane and accidentally launched a plain
 * `claude` somewhere else). Rebuilds the full launch command — system prompt
 * + MCP config + parent dirs + `--continue` — and re-sends it into the
 * existing orchestrator pane. Other panes, windows, and feature agents are
 * untouched.
 *
 * Falls back gracefully:
 * - no session            → tell the user to run `bn <project> start`
 * - no workspace window   → same
 * - no orchestrator pane  → same (start() is the rebuild path)
 */
import type { Context } from "../context.js";
import * as tmux from "../tmux.js";
import { buildOrchestratorClaudeCommand } from "../orchestratorAgent.js";
import { UsageError } from "../errors.js";

const WORKSPACE_WINDOW = "workspace";

export async function restartOrchestrator(ctx: Context): Promise<void> {
  const session = ctx.naming.session;
  const project = ctx.project;

  if (!(await tmux.hasSession(session))) {
    throw new UsageError(
      `session '${session}' not running — start with: bn ${project.name} start`,
    );
  }
  if (!(await tmux.windowExists(session, WORKSPACE_WINDOW))) {
    throw new UsageError(
      `no '${WORKSPACE_WINDOW}' window in session '${session}' — run: bn ${project.name} start`,
    );
  }

  const paneId = await tmux.findPaneByUserOption(
    session,
    WORKSPACE_WINDOW,
    "@banyan-pane",
    "orchestrator",
  );
  if (!paneId) {
    throw new UsageError(
      `no orchestrator pane found in '${session}:${WORKSPACE_WINDOW}' — run: bn ${project.name} start`,
    );
  }

  const gitRepos = project.repos.filter((r) => r.type !== "compose");
  if (gitRepos.length === 0) {
    throw new UsageError(
      `project '${project.name}' has no git repos — nothing to anchor the orchestrator to`,
    );
  }
  const primaryCwd = gitRepos[0]!.path;

  const { command: claudeCmd, parentDirs } =
    await buildOrchestratorClaudeCommand(project);

  await tmux.respawnPane(paneId, primaryCwd);
  await tmux.setPaneTitle(paneId, "orchestrator");
  await tmux.setPaneUserOption(paneId, "@banyan-pane", "orchestrator");
  await tmux.sendKeys(paneId, claudeCmd, { enter: true });

  ctx.logger.ok(
    `orchestrator respawned (${parentDirs.length} parent dir${parentDirs.length > 1 ? "s" : ""} in --add-dir, conversation resumed via --continue)`,
  );
}
