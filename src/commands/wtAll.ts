import { getProject, type Config } from "../config.js";
import * as git from "../git.js";
import * as tmux from "../tmux.js";
import * as claude from "../claude.js";
import * as docker from "../docker.js";
import * as naming from "../naming.js";
import { logger } from "../logger.js";
import { UsageError } from "../errors.js";
import { runHook, buildHookEnv } from "../hooks.js";
import { buildAgentPrompt, resolveMode, type AgentMode } from "../agentPrompt.js";
import { generateAutopilotSettings, needsSupervisorHook } from "../autopilot.js";
import { writeAgentState } from "../agentState.js";

/**
 * Spin up a feature environment for a project:
 *  - start every selected compose-type stack (isolated per-feature, dynamic ports)
 *  - create a git worktree in every selected git repo on branch `feature/<feature>`
 *  - open one tmux pane with every worktree as a `--add-dir` of a single
 *    Claude agent
 *
 * `opts.only` — if provided, filters to the listed repo names; otherwise all
 * repos of the project are included. Useful when a feature only needs the
 * front + back (skip mobile/app), or only the front (UI-only work), etc.
 * Per-repo maintenance commands (`rebase`, `merge`, `wt-rm`, `cleanup`) keep
 * their own repo argument.
 */
export async function wtAll(
  config: Config,
  projectName: string,
  feature: string,
  opts: {
    only?: string[];
    initialPrompt?: string;
    prefix?: string;
    /** Agent autonomy level. When undefined, defaults to `autonomous` if an
     *  `initialPrompt` is given (delegating a task), `interactive` otherwise
     *  (sitting next to plain claude). */
    mode?: AgentMode;
    /** Plan-review gate: require explicit approval (`banyan_approve_plan`
     *  / `bn approve`) before the agent starts working. Orthogonal to
     *  mode. Ignored for mode=interactive. */
    requireApproval?: boolean;
  } = {},
): Promise<void> {
  naming.assertValidFeature(feature);

  const project = getProject(config, projectName);
  const mode = resolveMode(opts.mode, !!opts.initialPrompt);

  if (opts.only) {
    const unknown = opts.only.filter(
      (n) => !project.repos.some((r) => r.name === n),
    );
    if (unknown.length > 0) {
      throw new UsageError(`unknown repo(s): ${unknown.join(", ")}`);
    }
  }

  const repos =
    opts.only && opts.only.length > 0
      ? project.repos.filter((r) => opts.only!.includes(r.name))
      : project.repos;

  if (repos.length === 0) {
    throw new UsageError(`project "${projectName}" has no repos configured`);
  }

  logger.info(
    `creating worktrees for feature '${feature}' in: ${repos.map((r) => r.name).join(", ")}`,
  );

  // Phase 1 — compose stacks (no worktree, no pane).
  for (const r of repos) {
    if (r.type !== "compose") continue;
    logger.info("");
    logger.info(`--- ${r.name} (compose) ---`);
    await docker.up(r, project, feature);
    logger.ok(`stack up: ${docker.composeProjectName(project, feature)}`);
  }

  // Phase 2 — git worktrees + post-create hook per repo.
  const gitRepos = repos.filter((r) => r.type !== "compose");
  const worktreePaths: string[] = [];
  const branch = naming.formatBranchName(feature, opts.prefix);
  // mainRepo for hook lookup: first git repo's main path
  const mainRepoPath = gitRepos[0]?.path ?? project.repos[0]!.path;
  for (const r of gitRepos) {
    // Reuse an existing worktree (new or legacy layout) before creating one.
    // Avoids "branch already checked out" failures when bn was previously
    // run with the old layout convention.
    const wtPath =
      naming.existingWorktreePath(r.path, feature)
      ?? naming.worktreePath(r.path, feature);
    logger.info("");
    logger.info(`--- ${r.name} ---`);
    await git.worktreeAdd(r.path, wtPath, branch);
    logger.ok(`worktree: ${wtPath} (${branch})`);
    worktreePaths.push(wtPath);
    await runHook(
      mainRepoPath,
      "worktree_created",
      buildHookEnv({
        project,
        repo: r,
        feature,
        worktreePath: wtPath,
        branch,
        baseBranch: r.baseBranch,
      }),
    );
  }

  // Phase 3 — one tmux pane + one Claude agent covering every git worktree.
  if (gitRepos.length === 0) {
    logger.info("");
    logger.ok(`done (compose stacks only, no pane created)`);
    logger.info(`inspect: bn ${projectName} env ls`);
    return;
  }

  const session = naming.sessionName(project.name);
  const agentsWin = naming.agentsWindowName(project.name);
  const primaryCwd = worktreePaths[0]!;
  const additionalDirs = worktreePaths.slice(1);
  const paneTitle =
    gitRepos.length === 1
      ? naming.windowName(gitRepos[0]!.name, feature)
      : feature;

  let paneId: string;
  if (!(await tmux.hasSession(session))) {
    paneId = await tmux.newSession(session, agentsWin, primaryCwd);
    logger.ok(`tmux session: ${session} (created)`);
    logger.ok(`tmux window: ${session}:${agentsWin}`);
  } else if (!(await tmux.windowExists(session, agentsWin))) {
    paneId = await tmux.newWindow(session, agentsWin, primaryCwd);
    logger.ok(`tmux window: ${session}:${agentsWin} (created)`);
  } else {
    paneId = await tmux.splitWindow(session, agentsWin, primaryCwd);
    logger.ok(`tmux pane added in ${session}:${agentsWin}`);
  }

  await tmux.setPaneTitle(paneId, paneTitle);
  await tmux.setPaneUserOption(paneId, "@banyan-pane", paneTitle);

  // Add a small "ops" terminal pane at the bottom of the agents window if it
  // doesn't exist yet. It sits at the first git repo's main path (not the
  // worktree) so the user can run `bn <proj> <cmd>` without leaving tmux.
  const OPS_TAG = "ops";
  const opsExisting = await tmux.findPaneByUserOption(
    session,
    agentsWin,
    "@banyan-pane",
    OPS_TAG,
  );
  if (!opsExisting) {
    const opsCwd = gitRepos[0]!.path;
    const opsPaneId = await tmux.splitWindow(session, agentsWin, opsCwd, {
      size: 20,
    });
    await tmux.setPaneTitle(opsPaneId, OPS_TAG);
    await tmux.setPaneUserOption(opsPaneId, "@banyan-pane", OPS_TAG);
    logger.ok(`ops terminal: ${opsCwd}`);
  }

  await tmux.enablePaneBorderLabels(session, agentsWin);
  // Use main-horizontal so the ops pane stays small at the bottom while the
  // claude pane(s) take the majority of the window.
  await tmux.applyLayout(session, agentsWin, "main-horizontal");
  // requireApproval is meaningless for interactive mode (user is right there).
  const requireApproval = mode === "interactive" ? false : !!opts.requireApproval;
  const settingsPath = needsSupervisorHook({ mode, requireApproval })
    ? generateAutopilotSettings(projectName, feature)
    : undefined;
  await claude.launchClaude(paneId, {
    additionalDirs,
    initialPrompt: opts.initialPrompt,
    systemPrompt: buildAgentPrompt(projectName, feature, mode),
    settingsPath,
  });
  // Persist how the agent was launched so `bn resume` can recreate it
  // with the same mode + requireApproval. Without this, every resumed
  // agent silently reverts to mode=interactive.
  writeAgentState({ project: projectName, feature, mode, requireApproval });
  await tmux.selectPane(paneId);
  await tmux.selectWindow(session, agentsWin);

  const dirsSuffix =
    additionalDirs.length > 0
      ? ` (+${additionalDirs.length} --add-dir)`
      : "";
  const modeSuffix = ` · agent: ${mode}${requireApproval ? " (plan review required)" : ""}`;
  logger.info("");
  logger.ok(
    `claude launched (pane: ${paneTitle}${dirsSuffix}) — ${gitRepos.length} worktree${gitRepos.length > 1 ? "s" : ""}${modeSuffix}`,
  );
  logger.info(`attach with: bn ${projectName} attach`);
}
