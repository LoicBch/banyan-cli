/**
 * `bn <project> merge <feature> <repo>` — entry point.
 *
 * Default flow (PR/MR):
 *   1. Auto-commit dirty changes in the worktree
 *   2. Detect the PR/MR provider from origin remote
 *   3. Pre-flight rebase on origin/<base> (auto-resolves conflicts via
 *      headless claude with cross-feature context)
 *   4. Push feature branch to origin
 *   5. Create MR (or reuse existing)
 *   6. If mergeable → merge now; if CI pending + --wait → wait;
 *      if conflict → abort with MR URL
 *
 * Use --local to fall back to the offline flow (no push, no MR).
 *
 * Implementation is split across:
 *   - merge/types.ts     — MergeOpts + helpers
 *   - merge/local.ts     — --local flow
 *   - merge/preflight.ts — pre-flight rebase + conflict resolver
 *   - merge/pr.ts        — PR/MR flow (push, MR create, status, merge)
 */
import type { Context } from "../context.js";
import * as git from "../git.js";
import { UsageError } from "../errors.js";
import { runHook, buildHookEnv } from "../hooks.js";
import { mergeLocal } from "./merge/local.js";
import { mergeViaPR } from "./merge/pr.js";

export type { MergeOpts } from "./merge/types.js";
import type { MergeOpts } from "./merge/types.js";

export async function merge(ctx: Context, opts: MergeOpts = {}): Promise<void> {
  if (!ctx.repo || !ctx.feature || !ctx.naming.branchName || !ctx.naming.worktreePath) {
    throw new UsageError(`usage: bn ${ctx.project.name} merge <feature> <repo>`);
  }

  // Compose-type repos have no git branches to merge. Skip.
  if (ctx.repo.type === "compose") {
    ctx.logger.info(`skip ${ctx.repo.name}: compose-type repo (no branch to merge)`);
    return;
  }

  // 1. Auto-commit pending worktree changes
  const dirty = await git.hasUncommittedChanges(ctx.naming.worktreePath);
  if (dirty) {
    const msg = `auto-commit: ${ctx.feature} before merge`;
    ctx.logger.info(`uncommitted changes in worktree — committing with "${msg}"`);
    await git.commitAll(ctx.naming.worktreePath, msg);
    ctx.logger.ok(`auto-committed worktree changes`);
  }

  const baseOverride = opts.base ?? ctx.repo.baseBranch;
  const base = await git.defaultBranch(ctx.repo.path, baseOverride);

  // pre_merge hook
  await runHook(
    ctx.repo.path,
    "pre_merge",
    buildHookEnv({
      project: ctx.project,
      repo: ctx.repo,
      feature: ctx.feature,
      worktreePath: ctx.naming.worktreePath,
      branch: ctx.naming.branchName,
      baseBranch: base,
    }),
  );

  if (opts.local) {
    await mergeLocal(ctx, base);
  } else {
    await mergeViaPR(ctx, base, opts);
    // Keep the local <base> branch in sync with origin so subsequent `bn wt`
    // (and any non-banyan work in the main repo) starts from up-to-date code.
    // The PR/MR flow merges remotely — without this, local <base> stays stale.
    const ff = await git.ffLocalBase(ctx.repo.path, base);
    if (ff.updated) {
      const how = ff.via === "merge-ff" ? " (via merge --ff-only)" : "";
      ctx.logger.ok(`local ${base} fast-forwarded to origin/${base}${how}`);
    } else {
      const counts = ff.diverge ? ` (local +${ff.diverge.ahead} / origin +${ff.diverge.behind})` : "";
      switch (ff.reason) {
        case "diverged":
          ctx.logger.warn(
            `local ${base} has diverged from origin/${base}${counts} — won't auto-fix; ` +
              `inspect with: git -C ${ctx.repo.path} log --oneline --left-right ${base}...origin/${base}`,
          );
          break;
        case "non-fast-forward":
          ctx.logger.info(
            `local ${base} is ahead of origin/${base}${counts} — nothing to fast-forward.`,
          );
          break;
        case "checked-out-elsewhere":
          ctx.logger.info(
            `local ${base} is checked out in a worktree — left alone (run \`git pull --ff-only\` there if needed).`,
          );
          break;
        case "no-remote-ref":
          ctx.logger.warn(`origin has no '${base}' branch — skipping fast-forward.`);
          break;
        default:
          ctx.logger.info(
            `local ${base} not fast-forwarded: ${(ff.message ?? "unknown").split("\n")[0]}`,
          );
      }
    }
  }

  // post_merge hook (runs whether MR/PR or local merge succeeded)
  await runHook(
    ctx.repo.path,
    "post_merge",
    buildHookEnv({
      project: ctx.project,
      repo: ctx.repo,
      feature: ctx.feature,
      worktreePath: ctx.naming.worktreePath,
      branch: ctx.naming.branchName,
      baseBranch: base,
    }),
  );
}
