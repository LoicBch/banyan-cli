import { existsSync } from "node:fs";
import type { Context } from "../context.js";
import * as git from "../git.js";
import { UsageError } from "../errors.js";

export async function rebase(ctx: Context, opts: { base?: string } = {}): Promise<void> {
  if (!ctx.repo || !ctx.feature || !ctx.naming.worktreePath) {
    throw new UsageError(`usage: bn ${ctx.project.name} rebase <feature> <repo>`);
  }
  // Compose-type repos have no git branches to rebase. Skip.
  if (ctx.repo.type === "compose") {
    ctx.logger.info(`skip ${ctx.repo.name}: compose-type repo (no branch to rebase)`);
    return;
  }
  if (!existsSync(ctx.naming.worktreePath)) {
    throw new UsageError(`worktree not found: ${ctx.naming.worktreePath}`);
  }

  const override = opts.base ?? ctx.repo.baseBranch;
  const base = await git.defaultBranch(ctx.repo.path, override);
  ctx.logger.info(`rebasing on origin/${base}…`);
  await git.fetch(ctx.repo.path);
  await git.rebase(ctx.naming.worktreePath, `origin/${base}`);
  ctx.logger.ok(`rebased ${ctx.naming.branchName} on origin/${base}`);
}
