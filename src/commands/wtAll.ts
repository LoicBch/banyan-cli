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
import { ensureBanyanMcpConfig } from "../claudeContext.js";
import { copyDeclaredFiles } from "../worktreeFiles.js";

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
    /** Reuse this specific tmux pane to launch claude instead of splitting a
     *  fresh one. Used by the interactive `bn wt` flow where we open a
     *  "describe your task" pane first, infer the slug from the typed text,
     *  then transform that same pane into the agent. */
    inheritPaneId?: string;
    /** Prepare everything but do NOT touch the tmux pane (no respawn, no
     *  sendKeys, no layout change). Used when banyan is itself running INSIDE
     *  the destination pane and would otherwise kill itself via respawn —
     *  the caller (a bash script in that pane) reads `launchScriptPath` from
     *  the return value and `exec`s it after banyan exits. */
    stagedLaunch?: boolean;
  } = {},
): Promise<{ launchScriptPath?: string }> {
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
  // For DRAFT features we defer this: spinning up the stack with `draft-<ts>`
  // as the docker-compose project name would leak the placeholder slug into
  // container names + volumes, and renaming after the fact = data loss.
  // The agent's `banyan_finalize_feature_name` call starts the stacks under
  // the real name once it's known.
  if (!naming.isDraftFeature(feature)) {
    for (const r of repos) {
      if (r.type !== "compose") continue;
      logger.info("");
      logger.info(`--- ${r.name} (compose) ---`);
      await docker.up(r, project, feature);
      logger.ok(`stack up: ${docker.composeProjectName(project, feature)}`);
    }
  } else {
    const composeRepos = repos.filter((r) => r.type === "compose");
    if (composeRepos.length > 0) {
      logger.info(
        `deferring ${composeRepos.length} compose stack${composeRepos.length > 1 ? "s" : ""} until finalize (${composeRepos.map((r) => r.name).join(", ")})`,
      );
    }
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

    // Branch new worktrees from origin/<base> so they start at the latest
    // upstream HEAD even when the local base branch is stale (e.g. previous
    // merges happened via the PR/MR flow, which only updates origin).
    const base = await git.defaultBranch(r.path, r.baseBranch);
    let startPoint: string | undefined;
    try {
      await git.fetchRef(r.path, base);
      startPoint = `origin/${base}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `fetch origin/${base} failed for ${r.name} (${msg}); starting worktree from local ${base}`,
      );
    }

    await git.worktreeAdd(r.path, wtPath, branch, startPoint);
    logger.ok(`worktree: ${wtPath} (${branch}${startPoint ? ` ← ${startPoint}` : ""})`);
    worktreePaths.push(wtPath);

    // Seed declared gitignored files (typically .env) from the main checkout.
    // Runs before the worktree_created hook so a hook can still override or
    // extend the result.
    if (r.copyOnWorktree && r.copyOnWorktree.length > 0) {
      copyDeclaredFiles(r.path, wtPath, r.copyOnWorktree, logger);
    }

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
    return {};
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
  if (opts.inheritPaneId && opts.stagedLaunch) {
    // We're INSIDE this pane already (called from a bash script via
    // `banyan ... _wt-stage-from-prompt`). Don't respawn — that would kill
    // us. Just retag the pane; the bash caller will exec the launch script
    // when banyan exits.
    paneId = opts.inheritPaneId;
    logger.ok(`tmux pane (${paneId}) staged for inline launch`);
  } else if (opts.inheritPaneId) {
    // Caller wants this exact pane to host the agent (banyan running OUTSIDE
    // the pane). Respawn the shell at the worktree cwd, then send keys.
    paneId = opts.inheritPaneId;
    await tmux.respawnPane(paneId, primaryCwd);
    logger.ok(`tmux pane reused (${paneId}) at ${primaryCwd}`);
  } else if (!(await tmux.hasSession(session))) {
    paneId = await tmux.newSession(session, agentsWin, primaryCwd);
    logger.ok(`tmux session: ${session} (created)`);
    logger.ok(`tmux window: ${session}:${agentsWin}`);
  } else if (!(await tmux.windowExists(session, agentsWin))) {
    paneId = await tmux.newWindow(session, agentsWin, primaryCwd);
    logger.ok(`tmux window: ${session}:${agentsWin} (created)`);
  } else {
    // Reuse an existing pane for this feature if one is already there.
    // Without this, `bn resume` (or any second wtAll for the same feature)
    // would split a duplicate pane next to the existing one.
    const existing = await tmux.findPaneByUserOption(
      session,
      agentsWin,
      "@banyan-pane",
      paneTitle,
    );
    if (existing) {
      paneId = existing;
      await tmux.respawnPane(paneId, primaryCwd);
      logger.ok(`tmux pane reused in ${session}:${agentsWin} (${paneTitle})`);
    } else {
      paneId = await tmux.splitWindow(session, agentsWin, primaryCwd);
      logger.ok(`tmux pane added in ${session}:${agentsWin}`);
    }
  }

  await tmux.setPaneTitle(paneId, paneTitle);
  await tmux.setPaneUserOption(paneId, "@banyan-pane", paneTitle);

  // In staged mode we skip ops-pane setup + layout reflow: doing tmux layout
  // changes while we're running inside the target pane would jostle our shell
  // mid-script. The next `bn start` / resume can repair the layout if needed.
  if (opts.stagedLaunch) {
    const requireApproval = mode === "interactive" ? false : !!opts.requireApproval;
    const settingsPath = needsSupervisorHook({ mode, requireApproval })
      ? generateAutopilotSettings(projectName, feature)
      : undefined;
    const { launchScriptPath } = await claude.launchClaude(paneId, {
      additionalDirs,
      initialPrompt: opts.initialPrompt,
      systemPrompt: buildAgentPrompt(projectName, feature, mode),
      projectName,
      feature,
      settingsPath,
      mcpConfig: ensureBanyanMcpConfig("feature"),
      stagedOnly: true,
    });
    writeAgentState({ project: projectName, feature, mode, requireApproval });
    logger.ok(`staged launch script: ${launchScriptPath}`);
    return { launchScriptPath };
  }

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
    projectName,
    feature,
    settingsPath,
    // Always pass the banyan MCP config so the agent can call
    // banyan_finalize_feature_name (mandatory for drafts), banyan_report_done,
    // banyan_set_todo, etc. Without this the system prompt's instructions to
    // call these tools become no-ops because the tools aren't registered.
    mcpConfig: ensureBanyanMcpConfig("feature"),
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
  return {};
}
