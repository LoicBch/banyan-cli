/**
 * `bn <project> orchestrator` — optional cross-feature agent.
 *
 * Spawns a single Claude session with:
 *   - read access to the parent dir of every repo (so it sees current AND
 *     future feature worktrees automatically),
 *   - the banyan MCP server wired in (so it can drive lifecycle: list /
 *     create / merge / cleanup features),
 *   - a system prompt explaining the orchestrator role.
 *
 * Lives in its own tmux window `orchestrator-<proj>` inside the project
 * session — separate from the `workspace` window (which also runs an
 * orchestrator pane plus a side terminal) and from the per-feature panes in
 * `agents-<proj>`. All three paths share the same Claude session via the
 * `--continue` marker, so messages are fungible across them.
 */
import type { Context } from "../context.js";
import * as tmux from "../tmux.js";
import * as naming from "../naming.js";
import {
  buildOrchestratorClaudeCommand,
  clearOrchestratorMarker,
  readOrchestratorMarker,
} from "../orchestratorAgent.js";
import { UsageError } from "../errors.js";

export async function start(ctx: Context): Promise<number> {
  const project = ctx.project;
  const session = naming.sessionName(project.name);
  const window = naming.orchestratorWindowName(project.name);

  if (
    (await tmux.hasSession(session)) &&
    (await tmux.windowExists(session, window))
  ) {
    ctx.logger.info(`orchestrator already running — attaching`);
    await tmux.selectWindow(session, window);
    return await tmux.attach(session);
  }

  const gitRepos = project.repos.filter((r) => r.type !== "compose");
  if (gitRepos.length === 0) {
    throw new UsageError(
      `project "${project.name}" has no git repos to scope the orchestrator on`,
    );
  }
  const primaryCwd = gitRepos[0]!.path;

  const { command, parentDirs } = await buildOrchestratorClaudeCommand(project);

  let paneId: string;
  if (!(await tmux.hasSession(session))) {
    paneId = await tmux.newSession(session, window, primaryCwd);
    ctx.logger.ok(`tmux session: ${session} (created)`);
    ctx.logger.ok(`tmux window: ${session}:${window}`);
  } else {
    paneId = await tmux.newWindow(session, window, primaryCwd);
    ctx.logger.ok(`tmux window: ${session}:${window} (created)`);
  }

  await tmux.setPaneTitle(paneId, "orchestrator");
  await tmux.setPaneUserOption(paneId, "@banyan-pane", "orchestrator");
  await tmux.enablePaneBorderLabels(session, window);

  await tmux.sendKeys(paneId, command, { enter: true });
  await tmux.selectWindow(session, window);

  ctx.logger.ok(
    `orchestrator launched (window: ${session}:${window}, ${parentDirs.length} parent dir${parentDirs.length > 1 ? "s" : ""})`,
  );
  ctx.logger.info(`attach with: bn ${project.name} attach`);
  return await tmux.attach(session);
}

export async function stop(ctx: Context): Promise<void> {
  const project = ctx.project;
  const session = naming.sessionName(project.name);
  const window = naming.orchestratorWindowName(project.name);

  if (!(await tmux.hasSession(session))) {
    ctx.logger.info(`session '${session}' not running`);
    return;
  }
  if (!(await tmux.windowExists(session, window))) {
    ctx.logger.info(`no orchestrator window for project '${project.name}'`);
    return;
  }
  await tmux.killWindow(session, window);
  ctx.logger.ok(`orchestrator stopped`);
  clearOrchestratorMarker(project.name);
}

export async function status(ctx: Context): Promise<void> {
  const project = ctx.project;
  const session = naming.sessionName(project.name);
  const window = naming.orchestratorWindowName(project.name);
  if (!(await tmux.hasSession(session))) {
    ctx.logger.info(`orchestrator: not running (session '${session}' absent)`);
    return;
  }
  if (!(await tmux.windowExists(session, window))) {
    ctx.logger.info(`orchestrator: not running (window absent)`);
    return;
  }
  ctx.logger.ok(`orchestrator: running at ${session}:${window}`);
  const ts = readOrchestratorMarker(project.name);
  if (ts) ctx.logger.info(`  started/recorded: ${ts}`);
}
