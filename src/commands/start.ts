/**
 * `bn <project> start` — launch the project's tmux workspace.
 *
 * Two paths:
 *
 *   1. Legacy: if `layoutScript` is set in the project config, exec the bash
 *      file. The script is responsible for the full session/window/pane
 *      setup. Kept for backward-compat with users who have a custom layout.
 *
 *   2. Native (default): build the workspace ourselves — a single window
 *      `workspace` with two panes: the orchestrator (left) and a free
 *      terminal (right). No bash script needed; each project gets the same
 *      ergonomic layout out of the box.
 *
 * Idempotent: if the session+workspace window already exist, it just
 * attaches. Other windows (agents-<proj>, test-<feature>, ...) are
 * preserved.
 */
import { existsSync } from "node:fs";
import type { Context } from "../context.js";
import { runInherit } from "../exec.js";
import * as tmux from "../tmux.js";
import { buildOrchestratorClaudeCommand } from "../orchestratorAgent.js";
import { UsageError } from "../errors.js";

const WORKSPACE_WINDOW = "workspace";

export async function start(ctx: Context): Promise<number> {
  const script = ctx.project.layoutScript;
  if (script) {
    if (!existsSync(script)) {
      throw new UsageError(`layout script not found: ${script}`);
    }
    return runInherit("/bin/bash", [script]);
  }
  return startNativeWorkspace(ctx);
}

async function startNativeWorkspace(ctx: Context): Promise<number> {
  const project = ctx.project;
  const session = ctx.naming.session;

  const gitRepos = project.repos.filter((r) => r.type !== "compose");
  if (gitRepos.length === 0) {
    throw new UsageError(
      `project '${project.name}' has no git repos. add one with: bn ${project.name} add-repo <name> [path]`,
    );
  }
  const primaryCwd = gitRepos[0]!.path;

  // If the workspace window is already up, just attach.
  if (
    (await tmux.hasSession(session)) &&
    (await tmux.windowExists(session, WORKSPACE_WINDOW))
  ) {
    ctx.logger.info(`workspace already running for '${project.name}' — attaching`);
    await tmux.selectWindow(session, WORKSPACE_WINDOW);
    return await tmux.attach(session);
  }

  // Build the orchestrator's claude command (also records the --continue
  // marker so a later relaunch picks up the same conversation).
  const { command: claudeCmd, parentDirs } = await buildOrchestratorClaudeCommand(project);

  // Create the session + workspace window if needed, otherwise add the
  // workspace window to the existing session (preserves any agents-<proj>
  // and test-<feature> windows already there).
  let orchPaneId: string;
  if (!(await tmux.hasSession(session))) {
    orchPaneId = await tmux.newSession(session, WORKSPACE_WINDOW, primaryCwd);
    ctx.logger.ok(`tmux session: ${session} (created)`);
    ctx.logger.ok(`tmux window: ${session}:${WORKSPACE_WINDOW} (created)`);
  } else {
    orchPaneId = await tmux.newWindow(session, WORKSPACE_WINDOW, primaryCwd);
    ctx.logger.ok(`tmux window: ${session}:${WORKSPACE_WINDOW} (created)`);
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
  await tmux.selectWindow(session, WORKSPACE_WINDOW);

  ctx.logger.ok(
    `workspace launched: orchestrator + terminal (${parentDirs.length} parent dir${parentDirs.length > 1 ? "s" : ""} in --add-dir)`,
  );
  return await tmux.attach(session);
}
