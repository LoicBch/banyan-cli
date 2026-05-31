/**
 * Legacy local merge: integrate base → feature first (conflicts isolated in
 * worktree), then feature → base in the main repo. Triggered by `--local`.
 */
import type { Context } from "../../context.js";
import * as git from "../../git.js";
import { UsageError } from "../../errors.js";
import { appendHistoryEvent } from "../../history.js";

export async function mergeLocal(ctx: Context, base: string): Promise<void> {
  const branch = ctx.naming.branchName!;
  const worktreePath = ctx.naming.worktreePath!;

  ctx.logger.info(`[local merge] fetch origin…`);
  await git.fetch(ctx.repo!.path);

  ctx.logger.info(`[local merge] integrating origin/${base} into feature…`);
  try {
    await git.mergeInto(worktreePath, `origin/${base}`);
  } catch {
    const conflicts = await git.getConflictingFiles(worktreePath);
    await git.abortMerge(worktreePath);
    const filesList =
      conflicts.length > 0
        ? `\nconflicting files:\n${conflicts.map((f) => `  - ${f}`).join("\n")}`
        : "";
    throw new UsageError(
      `conflict integrating origin/${base} into feature.${filesList}\n\n` +
        `resolve by:\n` +
        `  1. cd ${worktreePath}\n` +
        `  2. git merge origin/${base}\n` +
        `  3. resolve the conflicts (ask claude in this pane to help)\n` +
        `  4. git add -A && git commit\n` +
        `  5. re-run: bn ${ctx.project.name} merge ${ctx.feature} ${ctx.repo!.name} --local`,
    );
  }
  ctx.logger.ok(`${base} integrated into feature`);

  ctx.logger.info(`[local merge] checkout ${base} + pull --ff-only + merge --no-ff…`);
  await git.checkout(ctx.repo!.path, base);
  await git.pullFFOnly(ctx.repo!.path);
  try {
    await git.mergeNoFF(ctx.repo!.path, branch);
  } catch {
    await git.abortMerge(ctx.repo!.path);
    throw new UsageError(
      `unexpected conflict merging feature into ${base} locally.\n` +
        `investigate: cd ${ctx.repo!.path} && git status`,
    );
  }
  ctx.logger.ok(`merged ${branch} into ${base} locally`);
  try {
    appendHistoryEvent({
      kind: "merge",
      project: ctx.project.name,
      feature: ctx.feature!,
      repo: ctx.repo!.name,
      base,
      local: true,
      strategy: ctx.repo!.mergeStrategy ?? "merge",
    });
  } catch (err) {
    ctx.logger.warn(`history log write failed (non-fatal): ${(err as Error).message}`);
  }
  ctx.logger.info(`cleanup with: bn ${ctx.project.name} cleanup ${ctx.feature} ${ctx.repo!.name}`);
}
