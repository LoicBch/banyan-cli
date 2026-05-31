/**
 * `bn <project> start` — launch the project's tmux workspace.
 *
 * Builds a single window `workspace` with two panes: the orchestrator
 * (claude with full project context) on the left and a free terminal on
 * the right. Each project gets the same ergonomic layout out of the box.
 *
 * Idempotent: if the session + workspace window already exist, it just
 * attaches. Other windows (agents-<proj>, test-<feature>, ...) are
 * preserved across restarts.
 */
import type { Context } from "../context.js";
import * as tmux from "../tmux.js";
import { buildOrchestratorClaudeCommand } from "../orchestratorAgent.js";
import { UsageError } from "../errors.js";

const WORKSPACE_WINDOW = "workspace";

export async function start(ctx: Context): Promise<number> {
  await ensureWorkspace(ctx);
  await tmux.selectWindow(ctx.naming.session, WORKSPACE_WINDOW);
  return await tmux.attach(ctx.naming.session);
}

/**
 * Build the workspace window (orchestrator + terminal) if it isn't already
 * up. Idempotent; does NOT attach. Use this when you need the workspace to
 * exist (e.g. as window 1 during `bn resume`) without taking over the
 * terminal.
 */
export async function ensureWorkspace(ctx: Context): Promise<void> {
  const project = ctx.project;
  const session = ctx.naming.session;

  const gitRepos = project.repos.filter((r) => r.type !== "compose");
  if (gitRepos.length === 0) {
    throw new UsageError(
      `project '${project.name}' has no git repos. add one with: bn ${project.name} add-repo <name> [path]`,
    );
  }
  const primaryCwd = gitRepos[0]!.path;

  // Already built — nothing to do.
  if (
    (await tmux.hasSession(session)) &&
    (await tmux.windowExists(session, WORKSPACE_WINDOW))
  ) {
    ctx.logger.info(`workspace already running for '${project.name}'`);
    return;
  }

  // Build the orchestrator's claude command (also records the --continue
  // marker so a later relaunch picks up the same conversation).
  const { command: claudeCmd, parentDirs } = await buildOrchestratorClaudeCommand(project);

  // Create the session + workspace window if needed. If the session exists
  // but workspace doesn't, insert workspace as window 1 (`-b -t :0`) so it
  // stays the canonical first window even when agents/test windows already
  // exist (e.g. during `bn resume`).
  let orchPaneId: string;
  if (!(await tmux.hasSession(session))) {
    orchPaneId = await tmux.newSession(session, WORKSPACE_WINDOW, primaryCwd);
    ctx.logger.ok(`tmux session: ${session} (created)`);
    ctx.logger.ok(`tmux window: ${session}:${WORKSPACE_WINDOW} (created)`);
  } else {
    orchPaneId = await tmux.newWindowBefore(session, WORKSPACE_WINDOW, primaryCwd, 0);
    ctx.logger.ok(`tmux window: ${session}:${WORKSPACE_WINDOW} (created, position 1)`);
  }
  await tmux.setPaneTitle(orchPaneId, "orchestrator");
  await tmux.setPaneUserOption(orchPaneId, "@banyan-pane", "orchestrator");

  // Right pane: empty terminal at the same cwd, useful for ad-hoc
  // commands while the orchestrator is busy in the left pane.
  const termPaneId = await tmux.splitWindow(session, WORKSPACE_WINDOW, primaryCwd, {
    horizontal: true,
    size: 50,
  });
  await tmux.setPaneTitle(termPaneId, "terminal");
  await tmux.setPaneUserOption(termPaneId, "@banyan-pane", "terminal");

  await tmux.enablePaneBorderLabels(session, WORKSPACE_WINDOW);
  await tmux.sendKeys(orchPaneId, claudeCmd, { enter: true });
  await tmux.selectPane(orchPaneId);

  ctx.logger.ok(
    `workspace launched: orchestrator + terminal (${parentDirs.length} parent dir${parentDirs.length > 1 ? "s" : ""} in --add-dir)`,
  );
}
