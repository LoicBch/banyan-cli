import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { ConflictInfo } from "../git.js";
import * as git from "../git.js";
import type { Logger } from "../logger.js";
import { UsageError } from "../errors.js";

export interface ResolveOpts {
  projectName: string;
  feature: string;
  repoName: string;
  worktreePath: string;
  branch: string;
  baseRef: string;
  /** HEAD commit of the feature BEFORE the rebase was attempted. */
  preRebaseHead: string;
  logger: Logger;
  /** Skip the y/N prompt and launch the resolver straight away. */
  auto?: boolean;
  /** Max seconds to wait for the agent to finish resolving. */
  timeoutSec?: number;
}

async function confirmResolve(): Promise<boolean> {
  if (!stdin.isTTY) return false;
  const rl = createInterface({ input: stdin, output: stdout });
  const ans = await rl.question("Launch headless claude resolver? [Y/n] ");
  rl.close();
  const trimmed = ans.trim().toLowerCase();
  return trimmed === "" || trimmed === "y" || trimmed === "yes";
}

function prettyPrintConflicts(info: ConflictInfo, logger: Logger): void {
  logger.warn(
    `conflicts detected: ${info.files.length} file${info.files.length > 1 ? "s" : ""}, ` +
      `${info.totalHunks} hunk${info.totalHunks > 1 ? "s" : ""}, ~${info.totalLines} line${
        info.totalLines > 1 ? "s" : ""
      }`,
  );
  for (const f of info.files) {
    logger.info(`    ${f.path}  (${f.hunks} hunk${f.hunks > 1 ? "s" : ""}, ${f.lines} lines)`);
  }
}

function buildPrompt(opts: ResolveOpts, info: ConflictInfo): string {
  const fileList = info.files.map((f) => `  - ${f.path}`).join("\n");
  return [
    `A 'git rebase ${opts.baseRef}' is in progress in this worktree and has produced conflicts.`,
    `cwd: ${opts.worktreePath}`,
    `Feature branch: ${opts.branch}`,
    `Base: ${opts.baseRef}`,
    ``,
    `Files in conflict (${info.files.length}):`,
    fileList,
    ``,
    `Task:`,
    `  1. Run 'git status' to confirm state.`,
    `  2. Understand what this feature does: 'git log ${opts.baseRef}..HEAD --oneline'.`,
    `  3. Understand what ${opts.baseRef} brought: 'git log HEAD..${opts.baseRef} --oneline'.`,
    `  4. Edit each conflicting file to preserve BOTH intents. Remove all conflict markers.`,
    `  5. 'git add -A && GIT_EDITOR=true git rebase --continue' until the rebase completes.`,
    `  6. If you hit another conflict after continue, repeat 4-5.`,
    ``,
    `End state: 'git status' shows a clean working tree and no rebase in progress.`,
    `Do NOT push, do NOT create a branch, do NOT touch git remote. banyan handles those.`,
  ].join("\n");
}

/**
 * Spawn a headless `claude -p` subprocess in the worktree, stream its stdout
 * into banyan's terminal, and resolve with the exit code.
 *
 * Uses `--dangerously-skip-permissions` because the resolver is expected to
 * run multiple git commands, file edits, and sometimes a gradle/npm check,
 * on the user's own machine. Conflict resolution is a trusted-dev task; the
 * prompt explicitly forbids remote-touching operations.
 */
function runHeadlessClaude(
  prompt: string,
  cwd: string,
  timeoutSec: number,
  logger: Logger,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      prompt,
      "--dangerously-skip-permissions",
    ];
    const child = spawn("claude", args, {
      cwd,
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });
    const timer = setTimeout(() => {
      logger.warn(`headless claude hit timeout (${timeoutSec}s) — sending SIGTERM`);
      child.kill("SIGTERM");
    }, timeoutSec * 1000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

export async function resolveConflictsInteractive(
  opts: ResolveOpts,
  info: ConflictInfo,
): Promise<void> {
  prettyPrintConflicts(info, opts.logger);

  const go = opts.auto ? true : await confirmResolve();
  if (!go) {
    opts.logger.info(`rebase left in progress — resolve manually in ${opts.worktreePath}`);
    opts.logger.info(`or abort with: cd ${opts.worktreePath} && git rebase --abort`);
    throw new UsageError("conflict resolution skipped by user");
  }

  const prompt = buildPrompt(opts, info);
  const timeout = opts.timeoutSec ?? 600;
  opts.logger.info(`launching headless claude resolver (cwd=${opts.worktreePath}, timeout=${timeout}s)…`);
  opts.logger.info(`  claude output follows:`);
  opts.logger.info(`  ${"─".repeat(60)}`);

  const exitCode = await runHeadlessClaude(prompt, opts.worktreePath, timeout, opts.logger);

  opts.logger.info(`  ${"─".repeat(60)}`);
  if (exitCode !== 0) {
    throw new UsageError(
      `claude exited with code ${exitCode}. rebase may still be in progress — ` +
        `inspect: cd ${opts.worktreePath} && git status`,
    );
  }

  // Verify git state post-claude
  const stillInProgress = await git.isRebaseInProgress(opts.worktreePath);
  if (stillInProgress) {
    throw new UsageError(
      `claude finished but rebase is still in progress. ` +
        `inspect: cd ${opts.worktreePath} && git status\n` +
        `abort with: cd ${opts.worktreePath} && git rebase --abort`,
    );
  }
  const newHead = await git.currentHead(opts.worktreePath);
  if (newHead === opts.preRebaseHead) {
    throw new UsageError(
      `claude finished but HEAD is unchanged from pre-rebase state — likely aborted. ` +
        `inspect: cd ${opts.worktreePath} && git status`,
    );
  }
  opts.logger.ok(`conflicts resolved — rebase completed`);
}
