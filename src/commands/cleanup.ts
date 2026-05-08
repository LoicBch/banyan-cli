import type { Context } from "../context.js";
import * as git from "../git.js";
import * as tmux from "../tmux.js";
import * as docker from "../docker.js";
import * as naming from "../naming.js";
import { UsageError } from "../errors.js";
import { runHook, buildHookEnv } from "../hooks.js";
import { removeAutopilotSettings } from "../autopilot.js";
import { deleteApproval } from "../approval.js";
import { deleteAgentState } from "../agentState.js";

export interface CleanupOpts {
  /** Force-remove the worktree even if it has modified or untracked files,
   *  and force-delete the branch even if it has unmerged commits. */
  force?: boolean;
}

export async function cleanup(ctx: Context, opts: CleanupOpts = {}): Promise<void> {
  if (!ctx.repo || !ctx.feature) {
    throw new UsageError(`usage: bn ${ctx.project.name} cleanup <feature> <repo>`);
  }

  // compose: full teardown — stop containers AND drop volumes (fresh slate).
  if (ctx.repo.type === "compose") {
    ctx.logger.info(`tearing down compose stack for ${ctx.repo.name} (${ctx.feature})…`);
    await docker.downVolumes(ctx.repo, ctx.project, ctx.feature);
    ctx.logger.ok(
      `stack destroyed: ${docker.composeProjectName(ctx.project, ctx.feature)} (volumes removed)`,
    );
    return;
  }

  if (!ctx.naming.worktreePath || !ctx.naming.branchName || !ctx.naming.windowName) {
    throw new UsageError(`usage: bn ${ctx.project.name} cleanup <feature> <repo>`);
  }

  // before_worktree_remove hook
  await runHook(
    ctx.repo.path,
    "before_worktree_remove",
    buildHookEnv({
      project: ctx.project,
      repo: ctx.repo,
      feature: ctx.feature,
      worktreePath: ctx.naming.worktreePath,
      branch: ctx.naming.branchName,
    }),
  );

  await git.worktreeRemove(ctx.repo.path, ctx.naming.worktreePath, {
    force: opts.force,
  });
  ctx.logger.ok(
    `worktree removed: ${ctx.naming.worktreePath}${opts.force ? " (forced)" : ""}`,
  );

  await runHook(
    ctx.repo.path,
    "worktree_removed",
    buildHookEnv({
      project: ctx.project,
      repo: ctx.repo,
      feature: ctx.feature,
      branch: ctx.naming.branchName,
    }),
  );

  const base = await git.defaultBranch(ctx.repo.path, ctx.repo.baseBranch);
  const res = opts.force
    ? await git.forceDeleteBranch(ctx.repo.path, ctx.naming.branchName)
    : await git.safeDeleteBranch(ctx.repo.path, ctx.naming.branchName, base);
  if (res.deleted) {
    ctx.logger.ok(
      `branch deleted: ${ctx.naming.branchName}${opts.force ? " (forced)" : ""}`,
    );
  } else if (res.message) {
    ctx.logger.warn(res.message);
  }

  const session = ctx.naming.session;
  const agentsWin = naming.agentsWindowName(ctx.project.name);
  // With the multi-repo refactor, one feature = one pane tagged `<feature>`.
  // Older single-repo panes used `<repo>-<feature>`. Look for both shapes so
  // cleanup works regardless of when the pane was created.
  const paneTitleRepo = ctx.naming.windowName;   // "<repo>-<feature>"
  const paneTitleFeat = ctx.feature;             // "<feature>"

  if (await tmux.hasSession(session) && await tmux.windowExists(session, agentsWin)) {
    const paneId =
      (await tmux.findPaneByUserOption(session, agentsWin, "@banyan-pane", paneTitleFeat)) ??
      (await tmux.findPaneByUserOption(session, agentsWin, "@banyan-pane", paneTitleRepo)) ??
      (await tmux.findPaneByTitle(session, agentsWin, paneTitleFeat)) ??
      (await tmux.findPaneByTitle(session, agentsWin, paneTitleRepo));
    if (paneId) {
      await tmux.killPane(paneId);
      ctx.logger.ok(`tmux pane closed: ${paneTitleFeat}`);
      if (await tmux.windowExists(session, agentsWin)) {
        await tmux.applyLayout(session, agentsWin, "main-horizontal");
      }
    }
    // Silent when not found: this is normal on subsequent iterations
    // when multiple repos of the same feature share one pane.
  }

  // Drop the autopilot settings file if one was generated. Idempotent —
  // no-op if the feature wasn't run in autopilot mode.
  removeAutopilotSettings(ctx.project.name, ctx.feature);
  // Drop the plan-approval state file. Idempotent.
  deleteApproval(ctx.project.name, ctx.feature);
  // Drop the recorded agent launch options. Idempotent.
  deleteAgentState(ctx.project.name, ctx.feature);
}
