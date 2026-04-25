import type { Context } from "../context.js";
import * as git from "../git.js";
import * as tmux from "../tmux.js";
import * as docker from "../docker.js";
import * as naming from "../naming.js";
import { UsageError } from "../errors.js";
import { runHook, buildHookEnv } from "../hooks.js";

export async function cleanup(ctx: Context): Promise<void> {
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

  await git.worktreeRemove(ctx.repo.path, ctx.naming.worktreePath);
  ctx.logger.ok(`worktree removed: ${ctx.naming.worktreePath}`);

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
  const res = await git.safeDeleteBranch(
    ctx.repo.path,
    ctx.naming.branchName,
    base,
  );
  if (res.deleted) {
    ctx.logger.ok(`branch deleted: ${ctx.naming.branchName}`);
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
}
