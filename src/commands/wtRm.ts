import type { Context } from "../context.js";
import * as git from "../git.js";
import * as tmux from "../tmux.js";
import * as docker from "../docker.js";
import * as naming from "../naming.js";
import { UsageError } from "../errors.js";

export async function wtRm(ctx: Context): Promise<void> {
  if (!ctx.repo || !ctx.feature) {
    throw new UsageError(`usage: bn ${ctx.project.name} wt-rm <feature> <repo>`);
  }

  // compose: stop containers but keep volumes (cleanup does -v). Mirror wt flow.
  if (ctx.repo.type === "compose") {
    ctx.logger.info(`stopping compose stack for ${ctx.repo.name} (${ctx.feature})…`);
    await docker.down(ctx.repo, ctx.project, ctx.feature);
    ctx.logger.ok(
      `stack stopped: ${docker.composeProjectName(ctx.project, ctx.feature)} (volumes kept — use cleanup to drop)`,
    );
    return;
  }

  if (!ctx.naming.worktreePath || !ctx.naming.windowName) {
    throw new UsageError(`usage: bn ${ctx.project.name} wt-rm <feature> <repo>`);
  }

  await git.worktreeRemove(ctx.repo.path, ctx.naming.worktreePath);
  ctx.logger.ok(`worktree removed: ${ctx.naming.worktreePath}`);

  const session = ctx.naming.session;
  const agentsWin = naming.agentsWindowName(ctx.project.name);
  const paneTitleRepo = ctx.naming.windowName;
  const paneTitleFeat = ctx.feature;

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
    // Silent when not found (expected on subsequent repo iterations).
  }

  ctx.logger.info(
    `branch ${ctx.naming.branchName} kept. delete with: cd ${ctx.repo.path} && git branch -d ${ctx.naming.branchName}`,
  );
}
