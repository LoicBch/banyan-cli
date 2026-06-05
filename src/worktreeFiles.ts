/**
 * Copy gitignored seed files from a repo's main checkout into a fresh worktree.
 *
 * Used by `bn wt` to satisfy the common case where every worktree needs a
 * `.env` (or similar) that lives outside git. The list of files is declared
 * per-repo as `repo.copyOnWorktree` and validated upfront, so by the time we
 * land here every entry is a clean relative path without `..`.
 *
 * Behavior:
 *   - Each entry is resolved against `srcRoot` and `dstRoot`. Subdirectories
 *     in the entry are honored — `mkdir -p` runs on the dst side first.
 *   - Missing source → log and skip (no error). A common case after the user
 *     deletes a now-obsolete file from their main checkout.
 *   - Destination already exists → log and skip. We never overwrite, because
 *     the worktree may have been customized (e.g. via a `worktree_created`
 *     hook or a previous run) and clobbering would be the wrong default.
 *   - Defense-in-depth: re-check that the resolved dst stays inside dstRoot.
 *     The validator already rejects `..` / absolute paths, but a future bug
 *     elsewhere shouldn't be able to write outside the worktree.
 *
 * Returns a small report so callers can summarise to the user.
 */
import { existsSync, statSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";

export interface CopyLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface CopyReport {
  copied: string[];
  skippedMissingSrc: string[];
  skippedDstExists: string[];
}

export function copyDeclaredFiles(
  srcRoot: string,
  dstRoot: string,
  files: readonly string[],
  logger?: CopyLogger,
): CopyReport {
  const report: CopyReport = {
    copied: [],
    skippedMissingSrc: [],
    skippedDstExists: [],
  };
  if (files.length === 0) return report;

  const resolvedDstRoot = path.resolve(dstRoot);

  for (const rel of files) {
    // Re-validate at runtime as defense-in-depth.
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) {
      logger?.warn(`copyOnWorktree: skipping unsafe path '${rel}'`);
      continue;
    }

    const srcPath = path.join(srcRoot, rel);
    const dstPath = path.join(dstRoot, rel);

    // Make sure the resolved dst is still inside the worktree (catches symlink
    // shenanigans in dstRoot's parents).
    const resolvedDst = path.resolve(dstPath);
    if (
      resolvedDst !== resolvedDstRoot &&
      !resolvedDst.startsWith(resolvedDstRoot + path.sep)
    ) {
      logger?.warn(`copyOnWorktree: '${rel}' resolves outside the worktree — skipping`);
      continue;
    }

    if (!existsSync(srcPath)) {
      report.skippedMissingSrc.push(rel);
      logger?.info(`copyOnWorktree: ${rel} not in main checkout — skipping`);
      continue;
    }

    let st;
    try {
      st = statSync(srcPath);
    } catch (err) {
      logger?.warn(`copyOnWorktree: cannot stat ${rel}: ${(err as Error).message}`);
      continue;
    }
    if (!st.isFile()) {
      // Directories aren't supported in v1 — list each file explicitly. This
      // keeps the contract narrow and avoids surprise (e.g. accidentally
      // copying a huge node_modules-equivalent).
      logger?.warn(`copyOnWorktree: ${rel} is not a regular file — skipping`);
      continue;
    }

    if (existsSync(dstPath)) {
      report.skippedDstExists.push(rel);
      logger?.info(`copyOnWorktree: ${rel} already in worktree — keeping existing`);
      continue;
    }

    try {
      const parent = path.dirname(dstPath);
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      copyFileSync(srcPath, dstPath);
      report.copied.push(rel);
      logger?.info(`copyOnWorktree: ${rel} → worktree`);
    } catch (err) {
      // Permission denied / disk full / etc. — surface but don't fail the
      // whole `bn wt` flow because of one missing seed file.
      logger?.warn(`copyOnWorktree: failed to copy ${rel}: ${(err as Error).message}`);
    }
  }

  return report;
}
