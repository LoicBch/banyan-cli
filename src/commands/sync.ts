/**
 * `bn <project> sync` — rebase every active feature on its base branch.
 *
 * Use case: 5+ features in flight, base branch (develop) keeps moving with
 * merged PRs, all features falling behind. Running `bn rebase` per feature
 * is tedious. `sync` does the loop, with the same headless conflict resolver
 * the merge command uses (cross-feature aware via parent dirs + banyan MCP).
 *
 * Behaviour per (feature × repo) worktree:
 *   1. If worktree is dirty → log warning, skip (don't auto-commit).
 *   2. fetch origin
 *   3. tryRebase on origin/<base>
 *      - clean → done, branch refreshed
 *      - conflicts → spawn headless resolver. If it gives up, that worktree
 *        is left with the rebase paused for manual resolution.
 *   4. Report status: synced / dirty-skipped / conflict-resolved /
 *      conflict-failed.
 *
 * Order is deterministic (alphabetical by feature). Cross-feature smart
 * ordering can come later if needed; for now this is enough since the
 * resolver itself sees every other worktree via --add-dir.
 *
 * Default: no push. Pass `--push` to push --force-with-lease after each
 * successful rebase.
 */
import { getProject, type Config, type ProjectConfig, type RepoConfig } from "../config.js";
import * as git from "../git.js";
import * as naming from "../naming.js";
import { logger } from "../logger.js";
import { run } from "../exec.js";
import { resolveConflictsInteractive } from "./resolveConflicts.js";
import {
  ensureBanyanMcpConfig,
  projectParentDirs,
} from "../claudeContext.js";

export interface SyncOpts {
  base?: string;
  /** Push --force-with-lease after each successful rebase. */
  push?: boolean;
  /** Skip the headless conflict resolver, just report and move on. */
  noResolve?: boolean;
}

interface RepoOutcome {
  feature: string;
  repo: string;
  state:
    | "already-up-to-date"
    | "rebased-clean"
    | "rebased-resolved"
    | "rebased-pushed"
    | "dirty-skipped"
    | "no-worktree"
    | "no-origin"
    | "conflict-failed"
    | "error";
  detail?: string;
}

export async function sync(
  config: Config,
  projectName: string,
  opts: SyncOpts = {},
): Promise<void> {
  const project = getProject(config, projectName);

  // Discover active features by scanning worktrees on disk.
  const features = await discoverFeatures(project);
  if (features.length === 0) {
    logger.info(`no active features for '${projectName}'. nothing to sync.`);
    return;
  }
  features.sort();

  logger.info(
    `syncing ${features.length} feature${features.length > 1 ? "s" : ""}: ${features.join(", ")}`,
  );

  const outcomes: RepoOutcome[] = [];
  const addDirs = projectParentDirs(project);
  const mcpConfig = ensureBanyanMcpConfig();

  for (const feature of features) {
    logger.info("");
    logger.info(`── ${feature} ──────────────────────────────`);
    for (const repo of project.repos) {
      if (repo.type === "compose") continue;
      const wt = naming.existingWorktreePath(repo.path, feature);
      if (!wt) {
        outcomes.push({ feature, repo: repo.name, state: "no-worktree" });
        continue;
      }
      const outcome = await syncOne({
        project,
        repo,
        feature,
        worktreePath: wt,
        opts,
        addDirs,
        mcpConfig,
      });
      outcomes.push(outcome);
    }
  }

  printSummary(outcomes);
}

async function syncOne(args: {
  project: ProjectConfig;
  repo: RepoConfig;
  feature: string;
  worktreePath: string;
  opts: SyncOpts;
  addDirs: string[];
  mcpConfig: string;
}): Promise<RepoOutcome> {
  const { project, repo, feature, worktreePath, opts, addDirs, mcpConfig } = args;
  const branch = await naming.resolveBranchName(repo.path, feature);
  const tag = `${repo.name}`;

  // 1. Skip dirty worktrees (don't silently auto-commit user's WIP).
  const dirty = await git.hasUncommittedChanges(worktreePath).catch(() => false);
  if (dirty) {
    logger.warn(`  ${tag}: worktree has uncommitted changes — skipping (commit or stash first)`);
    return { feature, repo: repo.name, state: "dirty-skipped" };
  }

  // 2. Resolve base branch.
  const baseOverride = opts.base ?? repo.baseBranch;
  let base: string;
  try {
    base = await git.defaultBranch(repo.path, baseOverride);
  } catch (err) {
    logger.warn(`  ${tag}: could not determine base branch: ${(err as Error).message}`);
    return { feature, repo: repo.name, state: "error", detail: (err as Error).message };
  }

  // 3. Fetch origin (best-effort — local-only repos still get rebased
  //    against the existing local base if origin is unreachable).
  try {
    await git.fetch(repo.path);
  } catch (err) {
    logger.warn(`  ${tag}: fetch failed (${(err as Error).message}) — proceeding with local refs`);
  }

  // 4. Already up-to-date? `commitsAhead` returns the commits the FEATURE has
  //    over base. We also need to know if BASE has new commits over feature.
  //    Easiest: just attempt rebase; if HEAD doesn't move, branch was already current.
  const preHead = await git.currentHead(worktreePath);
  const result = await git.tryRebase(worktreePath, `origin/${base}`);
  if (result.clean) {
    const newHead = await git.currentHead(worktreePath);
    if (newHead === preHead) {
      logger.info(`  ${tag}: already up-to-date with origin/${base}`);
      return { feature, repo: repo.name, state: "already-up-to-date" };
    }
    logger.ok(`  ${tag}: rebased clean on origin/${base}`);
    if (opts.push) {
      const ok = await pushBranch(worktreePath, branch);
      if (ok) return { feature, repo: repo.name, state: "rebased-pushed" };
    }
    return { feature, repo: repo.name, state: "rebased-clean" };
  }

  // 5. Conflicts — spawn the headless resolver unless asked to skip.
  if (opts.noResolve) {
    logger.warn(
      `  ${tag}: conflicts detected on rebase — left paused (use bn rebase ${feature} ${repo.name} or resolve manually)`,
    );
    return {
      feature,
      repo: repo.name,
      state: "conflict-failed",
      detail: "rebase paused, --no-resolve was set",
    };
  }

  try {
    await resolveConflictsInteractive(
      {
        projectName: project.name,
        feature,
        repoName: repo.name,
        worktreePath,
        branch,
        baseRef: `origin/${base}`,
        preRebaseHead: preHead,
        logger,
        auto: true,
        addDirs,
        mcpConfig,
      },
      result.conflicts,
    );
  } catch (err) {
    logger.warn(`  ${tag}: resolver failed: ${(err as Error).message}`);
    return {
      feature,
      repo: repo.name,
      state: "conflict-failed",
      detail: (err as Error).message,
    };
  }

  logger.ok(`  ${tag}: rebased + conflicts auto-resolved`);
  if (opts.push) {
    const ok = await pushBranch(worktreePath, branch);
    if (ok) return { feature, repo: repo.name, state: "rebased-pushed" };
  }
  return { feature, repo: repo.name, state: "rebased-resolved" };
}

async function pushBranch(worktreePath: string, branch: string): Promise<boolean> {
  const r = await run(
    "git",
    ["push", "--set-upstream", "origin", branch, "--force-with-lease"],
    { cwd: worktreePath },
  );
  if (r.code !== 0) {
    logger.warn(`    push failed: ${r.stderr.trim()}`);
    return false;
  }
  logger.ok(`    pushed ${branch}`);
  return true;
}

async function discoverFeatures(project: ProjectConfig): Promise<string[]> {
  const set = new Set<string>();
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    const wts = await git.worktreeList(repo.path).catch(() => []);
    for (const wt of wts) {
      if (wt.path === repo.path) continue;
      const parsed = naming.parseWorktreePath(wt.path, repo.path);
      if (parsed) set.add(parsed.feature);
    }
  }
  return [...set];
}

function printSummary(outcomes: RepoOutcome[]): void {
  logger.info("");
  logger.info("── summary ─────────────────────────────────");
  const groups = new Map<RepoOutcome["state"], RepoOutcome[]>();
  for (const o of outcomes) {
    if (o.state === "no-worktree") continue;
    const list = groups.get(o.state) ?? [];
    list.push(o);
    groups.set(o.state, list);
  }
  const order: RepoOutcome["state"][] = [
    "already-up-to-date",
    "rebased-clean",
    "rebased-resolved",
    "rebased-pushed",
    "dirty-skipped",
    "conflict-failed",
    "no-origin",
    "error",
  ];
  for (const state of order) {
    const list = groups.get(state);
    if (!list || list.length === 0) continue;
    const labels = list.map((o) => `${o.feature}/${o.repo}`).join(", ");
    const label = humanLabel(state);
    if (state === "conflict-failed" || state === "error" || state === "dirty-skipped") {
      logger.warn(`  ${label} (${list.length}): ${labels}`);
    } else {
      logger.info(`  ${label} (${list.length}): ${labels}`);
    }
  }
}

function humanLabel(state: RepoOutcome["state"]): string {
  switch (state) {
    case "already-up-to-date":
      return "up-to-date";
    case "rebased-clean":
      return "rebased clean";
    case "rebased-resolved":
      return "rebased + auto-resolved";
    case "rebased-pushed":
      return "rebased + pushed";
    case "dirty-skipped":
      return "skipped (dirty)";
    case "no-origin":
      return "skipped (no origin)";
    case "no-worktree":
      return "no worktree";
    case "conflict-failed":
      return "conflict-failed";
    case "error":
      return "error";
  }
}
