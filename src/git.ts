import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { run, runOrThrow } from "./exec.js";
import { GitError } from "./errors.js";

export interface WorktreeEntry {
  path: string;
  branch?: string;
  head?: string;
}

export async function defaultBranch(repo: string, override?: string): Promise<string> {
  if (override) return override;
  const symRef = await run("git", ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], { cwd: repo });
  if (symRef.code === 0) {
    const ref = symRef.stdout.trim();
    const short = ref.split("/").pop();
    if (short) return short;
  }
  for (const b of ["main", "master"]) {
    const check = await run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${b}`], { cwd: repo });
    if (check.code === 0) return b;
  }
  return "main";
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  const r = await run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repo });
  return r.code === 0;
}

export async function worktreeAdd(
  repo: string,
  wtPath: string,
  branch: string,
): Promise<void> {
  if (existsSync(wtPath)) {
    return;
  }
  // Ensure the parent directory exists. `git worktree add` does NOT create
  // intermediate directories itself, and our new layout puts worktrees inside
  // a `worktree-<repo>` subdir that may not exist yet.
  mkdirSync(dirname(wtPath), { recursive: true });
  const withNew = await run("git", ["worktree", "add", wtPath, "-b", branch], { cwd: repo });
  if (withNew.code === 0) return;

  const existing = await run("git", ["worktree", "add", wtPath, branch], { cwd: repo });
  if (existing.code === 0) return;

  throw new GitError(
    `could not create worktree at ${wtPath}:\n${withNew.stderr.trim()}\n${existing.stderr.trim()}`,
  );
}

export async function worktreeRemove(repo: string, wtPath: string): Promise<void> {
  if (!existsSync(wtPath)) return;
  const r = await run("git", ["worktree", "remove", wtPath], { cwd: repo });
  if (r.code !== 0) {
    throw new GitError(`worktree remove failed: ${r.stderr.trim() || r.stdout.trim()}`);
  }
}

export async function worktreeList(repo: string): Promise<WorktreeEntry[]> {
  const out = await runOrThrow("git", ["worktree", "list", "--porcelain"], { cwd: repo });
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> = {};
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) entries.push(current as WorktreeEntry);
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      current.branch = ref.replace(/^refs\/heads\//, "");
    }
  }
  if (current.path) entries.push(current as WorktreeEntry);
  return entries;
}

export async function fetch(repo: string, remote = "origin"): Promise<void> {
  const r = await run("git", ["fetch", remote], { cwd: repo });
  if (r.code !== 0) {
    throw new GitError(`fetch ${remote} failed: ${r.stderr.trim()}`);
  }
}

export async function rebase(wtPath: string, upstream: string): Promise<void> {
  const r = await run("git", ["rebase", upstream], { cwd: wtPath });
  if (r.code !== 0) {
    throw new GitError(
      `rebase on ${upstream} failed in ${wtPath}:\n${r.stderr.trim() || r.stdout.trim()}\n` +
        `resolve manually: cd ${wtPath} && git status`,
    );
  }
}

export async function checkout(repo: string, branch: string): Promise<void> {
  const r = await run("git", ["checkout", branch], { cwd: repo });
  if (r.code !== 0) {
    throw new GitError(`checkout ${branch} failed: ${r.stderr.trim()}`);
  }
}

export async function pullFFOnly(repo: string): Promise<void> {
  const r = await run("git", ["pull", "--ff-only"], { cwd: repo });
  if (r.code !== 0) {
    throw new GitError(`pull --ff-only failed: ${r.stderr.trim()}`);
  }
}

export async function mergeNoFF(repo: string, branch: string): Promise<void> {
  const r = await run("git", ["merge", "--no-ff", branch], { cwd: repo });
  if (r.code !== 0) {
    throw new GitError(
      `merge ${branch} failed (likely conflicts):\n${r.stderr.trim() || r.stdout.trim()}`,
    );
  }
}

export async function mergeInto(cwd: string, branch: string): Promise<void> {
  const r = await run("git", ["merge", branch], { cwd });
  if (r.code !== 0) {
    throw new GitError(
      `merge ${branch} failed:\n${r.stderr.trim() || r.stdout.trim()}`,
    );
  }
}

export async function getConflictingFiles(cwd: string): Promise<string[]> {
  const r = await run("git", ["diff", "--name-only", "--diff-filter=U"], { cwd });
  if (r.code !== 0) return [];
  return r.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
}

export async function abortMerge(cwd: string): Promise<void> {
  await run("git", ["merge", "--abort"], { cwd });
  // ignore errors (no merge in progress)
}

export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const r = await run("git", ["status", "--porcelain"], { cwd });
  if (r.code !== 0) {
    throw new GitError(`git status failed in ${cwd}: ${r.stderr.trim()}`);
  }
  return r.stdout.trim().length > 0;
}

export async function commitAll(cwd: string, message: string): Promise<void> {
  const add = await run("git", ["add", "-A"], { cwd });
  if (add.code !== 0) {
    throw new GitError(`git add -A failed: ${add.stderr.trim()}`);
  }
  const commit = await run("git", ["commit", "-m", message], { cwd });
  if (commit.code !== 0) {
    throw new GitError(`git commit failed: ${commit.stderr.trim() || commit.stdout.trim()}`);
  }
}

export async function safeDeleteBranch(
  repo: string,
  branch: string,
  base?: string,
): Promise<{ deleted: boolean; message?: string }> {
  // 1. Fast path: branch is an ancestor of HEAD (regular merge / rebase).
  const ancestor = await run(
    "git",
    ["merge-base", "--is-ancestor", branch, "HEAD"],
    { cwd: repo },
  );
  if (ancestor.code === 0) {
    return forceDelete(repo, branch);
  }

  // 2. Squash-merge fallback: ask origin for a fresh state, then check via
  //    `git cherry` whether every commit of `branch` has an equivalent patch
  //    on `origin/<base>`. This is the canonical squash-detection idiom
  //    (cherry uses patch-id so a squashed commit counts as equivalent).
  if (base) {
    await run("git", ["fetch", "origin", base], { cwd: repo });
    const remoteBase = `origin/${base}`;
    const refCheck = await run(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/remotes/${remoteBase}`],
      { cwd: repo },
    );
    if (refCheck.code === 0) {
      const cherry = await run(
        "git",
        ["cherry", remoteBase, branch],
        { cwd: repo },
      );
      if (cherry.code === 0) {
        const lines = cherry.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
        const anyUnmerged = lines.some((l) => l.startsWith("+"));
        if (lines.length === 0 || !anyUnmerged) {
          // All patches are already in origin/<base> → safe to force-delete.
          return forceDelete(repo, branch);
        }
      }
    }
  }

  return {
    deleted: false,
    message:
      `branch "${branch}" has commits not merged into the current branch — not deleted.\n` +
      `review with: cd ${repo} && git log HEAD..${branch} --oneline\n` +
      `force delete with: cd ${repo} && git branch -D ${branch}`,
  };
}

async function forceDelete(
  repo: string,
  branch: string,
): Promise<{ deleted: boolean; message?: string }> {
  const del = await run("git", ["branch", "-D", branch], { cwd: repo });
  if (del.code === 0) return { deleted: true };
  return {
    deleted: false,
    message: `branch "${branch}" delete failed: ${del.stderr.trim() || del.stdout.trim()}`,
  };
}

// ---------------------------------------------------------------------------
// Conflict preview / auto-resolution support
// ---------------------------------------------------------------------------

export interface ConflictFile {
  path: string;
  hunks: number;
  lines: number;
}

export interface ConflictInfo {
  files: ConflictFile[];
  totalHunks: number;
  totalLines: number;
}

/**
 * Run `git rebase <baseRef>` in the worktree.
 *  - If the rebase completes cleanly → `{ clean: true }` (the worktree is now
 *    rebased, no further action needed).
 *  - If conflicts arise → git leaves the repo in the "rebase in progress"
 *    state. We parse the conflict files and return details. The caller can
 *    either let an agent resolve them in-place then `git rebase --continue`,
 *    or call `abortRebase()` to roll back.
 */
export async function tryRebase(
  worktreePath: string,
  baseRef: string,
): Promise<{ clean: true } | { clean: false; conflicts: ConflictInfo }> {
  const r = await run("git", ["rebase", baseRef], { cwd: worktreePath });
  if (r.code === 0) {
    return { clean: true };
  }
  const conflicts = await describeCurrentConflicts(worktreePath);
  if (conflicts.files.length === 0) {
    // rebase failed but no conflict files visible — abort to be safe
    await abortRebase(worktreePath);
    throw new GitError(
      `rebase ${baseRef} failed without reporting conflict files:\n${r.stderr.trim() || r.stdout.trim()}`,
    );
  }
  return { clean: false, conflicts };
}

export async function describeCurrentConflicts(
  worktreePath: string,
): Promise<ConflictInfo> {
  const files = await getConflictingFiles(worktreePath);
  const infos: ConflictFile[] = [];
  let totalHunks = 0;
  let totalLines = 0;
  for (const f of files) {
    try {
      const content = readFileSync(join(worktreePath, f), "utf8");
      const hunks = (content.match(/^<{7} /gm) || []).length;
      const lines = countConflictLines(content);
      infos.push({ path: f, hunks, lines });
      totalHunks += hunks;
      totalLines += lines;
    } catch {
      // unreadable (binary?) — still report the file but with zero metrics
      infos.push({ path: f, hunks: 0, lines: 0 });
    }
  }
  return { files: infos, totalHunks, totalLines };
}

function countConflictLines(content: string): number {
  let count = 0;
  let inConflict = false;
  for (const line of content.split("\n")) {
    if (line.startsWith("<<<<<<< ")) {
      inConflict = true;
      continue;
    }
    if (line.startsWith(">>>>>>> ")) {
      inConflict = false;
      continue;
    }
    if (line.startsWith("=======") && inConflict) continue;
    if (inConflict) count++;
  }
  return count;
}

export async function abortRebase(worktreePath: string): Promise<void> {
  await run("git", ["rebase", "--abort"], { cwd: worktreePath });
}

/** True while `.git/rebase-merge` or `.git/rebase-apply` exists. */
export async function isRebaseInProgress(worktreePath: string): Promise<boolean> {
  for (const name of ["rebase-merge", "rebase-apply"]) {
    const r = await run("git", ["rev-parse", "--git-path", name], {
      cwd: worktreePath,
    });
    if (r.code !== 0) continue;
    const p = r.stdout.trim();
    if (!p) continue;
    const resolved = p.startsWith("/") ? p : join(worktreePath, p);
    if (existsSync(resolved)) return true;
  }
  return false;
}

/** Current HEAD commit SHA of the worktree. */
export async function currentHead(worktreePath: string): Promise<string> {
  const out = await runOrThrow("git", ["rev-parse", "HEAD"], { cwd: worktreePath });
  return out.trim();
}

/** Number of commits on <worktreePath> HEAD that are not on `baseRef`. */
export async function commitsAhead(
  worktreePath: string,
  baseRef: string,
): Promise<number> {
  const r = await run(
    "git",
    ["rev-list", "--count", `${baseRef}..HEAD`],
    { cwd: worktreePath },
  );
  if (r.code !== 0) return 0;
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Force-push with lease — use after a rebase that rewrites history. */
export async function forcePushWithLease(
  worktreePath: string,
  branch: string,
): Promise<void> {
  const r = await run(
    "git",
    ["push", "--force-with-lease", "origin", branch],
    { cwd: worktreePath },
  );
  if (r.code !== 0) {
    throw new GitError(
      `force-push ${branch} failed: ${r.stderr.trim() || r.stdout.trim()}`,
    );
  }
}
