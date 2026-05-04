/**
 * PR/MR flow: pre-flight rebase → push → create or reuse MR → wait for stable
 * status → merge (with retry on transient errors).
 */
import type { Context } from "../../context.js";
import * as git from "../../git.js";
import { UsageError } from "../../errors.js";
import { run } from "../../exec.js";
import { detectProvider } from "../../pr/detect.js";
import type { PRProvider, MRStatus } from "../../pr/types.js";
import { runPreflightRebase } from "./preflight.js";
import { humanizeFeatureTitle, type MergeOpts } from "./types.js";

export async function mergeViaPR(
  ctx: Context,
  base: string,
  opts: MergeOpts,
): Promise<void> {
  const branch = ctx.naming.branchName!;
  const worktreePath = ctx.naming.worktreePath!;
  const repoPath = ctx.repo!.path;

  // 1. Detect provider
  const provider = await detectProvider(repoPath);
  if (!provider) {
    throw new UsageError(
      `no supported PR provider for ${repoPath}. use --local to merge locally, ` +
        `or configure a GitHub / GitLab remote.`,
    );
  }
  ctx.logger.info(`using ${provider.name} provider (${provider.cli})`);

  const notReady = await provider.checkReady();
  if (notReady) throw new UsageError(notReady);

  // 2. Pre-flight local rebase: catch conflicts BEFORE touching origin.
  if (!opts.skipPreflight) {
    await runPreflightRebase(ctx, base, opts);
  }

  // 2b. If the branch now has no commits or diff vs origin/<base>, the feature
  //     is effectively already on base (likely absorbed by a sibling merge).
  //     Skip push/MR/merge — there's nothing to ship.
  const aheadCount = await git.commitsAhead(worktreePath, `origin/${base}`);
  if (aheadCount === 0) {
    ctx.logger.info(
      `${branch} has no commits ahead of origin/${base} — already merged via a sibling branch. skipping push/MR.`,
    );
    return;
  }

  // 3. Push feature branch
  ctx.logger.info(`pushing ${branch} to origin…`);
  const push = await run(
    "git",
    ["push", "--set-upstream", "origin", branch, "--force-with-lease"],
    { cwd: worktreePath },
  );
  if (push.code !== 0) {
    throw new UsageError(`git push failed:\n${push.stderr.trim()}`);
  }
  ctx.logger.ok(`pushed ${branch}`);

  // 4. Find existing MR or create one
  const existing = await provider.status(repoPath, branch);
  let mrUrl: string;
  if (existing.exists && existing.url) {
    mrUrl = existing.url;
    ctx.logger.info(`found existing MR/PR: ${mrUrl}`);
  } else {
    ctx.logger.info(`creating MR/PR…`);
    const title = humanizeFeatureTitle(ctx.feature!);
    const { url } = await provider.create(repoPath, branch, {
      title,
      body: `Automated MR from banyan for feature \`${ctx.feature}\`.`,
      baseBranch: base,
      draft: opts.draft,
      removeSourceBranch: true,
    });
    mrUrl = url;
    ctx.logger.ok(`MR/PR created: ${mrUrl}`);
  }

  if (opts.open) await provider.openInBrowser(repoPath, branch);

  if (opts.draft) {
    ctx.logger.info(`MR/PR created as draft — not attempting merge.`);
    return;
  }

  // 5. Evaluate status, merge or exit with a message
  const status = await waitForStableStatus(ctx, provider, repoPath, branch);
  await handleMergeAttempt(ctx, provider, base, branch, repoPath, status, opts, mrUrl);
}

/**
 * Poll MR status until it stabilises. GitLab frequently reports `conflicts`
 * or `unknown` in the seconds right after a push/rebase while it recomputes
 * `merge_status` — retrying a few times avoids a false negative.
 */
async function waitForStableStatus(
  ctx: Context,
  provider: PRProvider,
  repoPath: string,
  branch: string,
): Promise<MRStatus> {
  const delays = [1500, 3000, 5000]; // ~9.5s max
  let status = await provider.status(repoPath, branch);
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (status.state !== "conflicts" && status.state !== "unknown") return status;
    const delay = delays[attempt]!;
    ctx.logger.info(
      `MR status is '${status.state}' — GitLab may still be computing. retrying in ${delay / 1000}s…`,
    );
    await new Promise((r) => setTimeout(r, delay));
    status = await provider.status(repoPath, branch);
  }
  return status;
}

async function handleMergeAttempt(
  ctx: Context,
  provider: PRProvider,
  base: string,
  branch: string,
  repoPath: string,
  status: MRStatus,
  opts: MergeOpts,
  mrUrl: string,
): Promise<void> {
  switch (status.state) {
    case "mergeable":
      ctx.logger.info(`mergeable — merging with strategy=${opts.strategy ?? "squash"}…`);
      await mergeWithRetry(ctx, provider, repoPath, branch, opts);
      ctx.logger.ok(`merged into ${base} via ${provider.name}`);
      ctx.logger.info(`cleanup with: bn ${ctx.project.name} cleanup ${ctx.feature} ${ctx.repo!.name}`);
      break;

    case "ci_pending":
      if (opts.wait) {
        ctx.logger.info(`CI running, --wait set → scheduling auto-merge when green…`);
        await provider.merge(repoPath, branch, {
          strategy: opts.strategy ?? "squash",
          waitForCI: true,
          removeSourceBranch: true,
        });
        ctx.logger.ok(`merge scheduled (will happen when pipeline passes)`);
      } else {
        ctx.logger.warn(
          `CI in progress (${status.ciPipelineStatus ?? "pending"}). re-run with --wait to auto-merge, ` +
            `or monitor via: ${mrUrl}`,
        );
      }
      break;

    case "ci_failed":
      throw new UsageError(
        `CI pipeline failed (${status.ciPipelineStatus}). ` +
          `fix and push again, then re-run merge.\n  ${mrUrl}`,
      );

    case "conflicts":
      throw new UsageError(
        `MR has conflicts with ${base}. resolve via:\n` +
          `  a) web UI → ${mrUrl}\n` +
          `  b) locally: bn ${ctx.project.name} rebase ${ctx.feature} ${ctx.repo!.name} ` +
          `then git push --force-with-lease, then re-run merge`,
      );

    case "draft":
      ctx.logger.warn(
        `MR is in draft. mark it ready via web UI or provider CLI, then re-run merge.\n  ${mrUrl}`,
      );
      break;

    default:
      ctx.logger.warn(
        `MR state unknown (${status.rawMessage ?? "no details"}). check manually:\n  ${mrUrl}`,
      );
  }
}

/**
 * GitLab often needs a few seconds after MR creation to compute the merge
 * status. The API returns 405 Method Not Allowed when `merge_status` is not
 * yet `can_be_merged`. Retry with short backoff to absorb the race.
 * Only retries on errors that look transient (405, "not yet", "still checking").
 */
async function mergeWithRetry(
  ctx: Context,
  provider: PRProvider,
  repoPath: string,
  branch: string,
  opts: MergeOpts,
): Promise<void> {
  const delays = [1500, 3000, 5000, 8000]; // ~17s total
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await provider.merge(repoPath, branch, {
        strategy: opts.strategy ?? "squash",
        removeSourceBranch: true,
      });
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);

      // MR/PR already closed (merged or manually closed). Provider status may
      // still report the URL, but the merge API rejects a non-open MR. Treat
      // as a benign no-op so the parent `merge` flow can move on to the next repo.
      if (/no open merge request|not open|already merged|closed merge request/i.test(msg)) {
        ctx.logger.info(`MR/PR is not open (likely already merged) — skipping merge step`);
        return;
      }

      // Real conflicts → actionable error, no retry.
      if (/merge conflicts?\b|has conflicts/i.test(msg)) {
        throw new UsageError(
          `merge conflicts with base branch — resolve by rebasing:\n` +
            `  bn ${ctx.project.name} rebase ${ctx.feature} ${ctx.repo!.name}\n` +
            `then push and re-run:\n` +
            `  bn ${ctx.project.name} merge ${ctx.feature} ${ctx.repo!.name}`,
        );
      }

      const transient =
        /\b405\b|method not allowed|still.*checking|not yet|merge_status|not_open/i.test(
          msg,
        );
      if (!transient || attempt === delays.length) {
        throw err;
      }
      const delay = delays[attempt]!;
      ctx.logger.warn(
        `merge attempt ${attempt + 1} returned transient error — retrying in ${delay / 1000}s…`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  if (lastErr) throw lastErr;
}
