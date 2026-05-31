/**
 * Pre-flight rebase: fetch origin/<base>, attempt local rebase. If conflicts,
 * delegate to the headless claude resolver (with cross-feature context). On
 * success, the branch is up-to-date with base and ready to push.
 */
import type { Context } from "../../context.js";
import * as git from "../../git.js";
import { UsageError } from "../../errors.js";
import { resolveConflictsInteractive } from "../resolveConflicts.js";
import {
  ensureBanyanMcpConfig,
  projectParentDirs,
} from "../../claudeContext.js";
import type { MergeOpts } from "./types.js";

export async function runPreflightRebase(
  ctx: Context,
  base: string,
  opts: MergeOpts,
): Promise<void> {
  const worktreePath = ctx.naming.worktreePath!;
  const branch = ctx.naming.branchName!;
  const repoPath = ctx.repo!.path;

  ctx.logger.info(`pre-flight: fetching origin/${base}…`);
  await git.fetch(repoPath);

  // Capture pre-rebase HEAD so the resolver can distinguish a clean completion
  // (HEAD moved, OR all commits dropped as already-upstream) from an abort
  // (HEAD restored to this exact commit).
  const preRebaseHead = await git.currentHead(worktreePath);

  ctx.logger.info(`pre-flight: attempting local rebase on origin/${base}…`);
  const result = await git.tryRebase(worktreePath, `origin/${base}`);
  if (result.clean) {
    ctx.logger.ok(`rebase clean — branch ${branch} is up-to-date with origin/${base}`);
    return;
  }

  await resolveConflictsInteractive(
    {
      projectName: ctx.project.name,
      feature: ctx.feature!,
      repoName: ctx.repo!.name,
      worktreePath,
      branch,
      baseRef: `origin/${base}`,
      preRebaseHead,
      logger: ctx.logger,
      // Resolver runs by default. opts.noResolve flips back to manual:
      // the function will report and exit, leaving the rebase paused for
      // the user to resolve.
      auto: !opts.noResolve,
      // Cross-feature awareness: same scope as the orchestrator.
      addDirs: projectParentDirs(ctx.project),
      mcpConfig: ensureBanyanMcpConfig("resolver"),
    },
    result.conflicts,
  );

  // Sanity: HEAD moved and no rebase in progress → we're good.
  const stillRebasing = await git.isRebaseInProgress(worktreePath);
  if (stillRebasing) {
    throw new UsageError(
      `rebase still in progress after resolver`,
      {
        title: `rebase paused with unresolved conflicts (${ctx.repo!.name})`,
        cause:
          `The headless claude resolver couldn't finish — likely a stream timeout or it gave up on a ` +
          `tricky conflict. The worktree is left mid-rebase so you can finish by hand or retry.`,
        fix: [
          `cd ${worktreePath}`,
          `git status                # see the conflict files`,
          `# resolve, then:`,
          `git add -A && git rebase --continue`,
          `# or to bail entirely: git rebase --abort`,
          `# then re-run: bn ${ctx.project.name} merge ${ctx.feature} ${ctx.repo!.name}`,
        ],
      },
    );
  }
}
