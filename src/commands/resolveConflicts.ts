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
  /**
   * Extra `--add-dir` paths so the resolver can read sibling worktrees of
   * OTHER features (cross-feature awareness). Typically the parent dirs of
   * every repo in the project — same scope as the orchestrator.
   */
  addDirs?: string[];
  /**
   * Path to a Claude `--mcp-config` json giving the resolver access to the
   * banyan MCP tools (banyan_list_features, banyan_feature_status, ...).
   */
  mcpConfig?: string;
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
  const crossFeatureSection = opts.mcpConfig
    ? [
        ``,
        `Cross-feature context (banyan project "${opts.projectName}"):`,
        `- You also have read access (via --add-dir) to the parent directory of`,
        `  every repo in this project, so you can inspect SIBLING worktrees of`,
        `  other in-flight features. They live as '<repo-path>-<other-feature>'.`,
        `- The banyan MCP server is wired in. You can call:`,
        `    banyan_list_features("${opts.projectName}")        — see all active features`,
        `    banyan_feature_status("${opts.projectName}", name) — git state per repo`,
        `- Use this BEFORE editing if a conflict's origin is unclear: another`,
        `  feature merged recently may explain the incoming hunk. Reading the`,
        `  sibling worktree's diff is often the fastest way to understand intent.`,
        `- Don't modify sibling worktrees. Read-only.`,
      ].join("\n")
    : "";
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
    crossFeatureSection,
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
  extras: { addDirs?: string[]; mcpConfig?: string } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const args: string[] = ["-p", prompt, "--dangerously-skip-permissions"];
    if (extras.addDirs && extras.addDirs.length > 0) {
      args.push("--add-dir", ...extras.addDirs);
    }
    if (extras.mcpConfig) {
      args.push("--mcp-config", extras.mcpConfig);
    }
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
  const ctxBits: string[] = [];
  if (opts.addDirs && opts.addDirs.length > 0) {
    ctxBits.push(`+${opts.addDirs.length} --add-dir`);
  }
  if (opts.mcpConfig) ctxBits.push("banyan MCP");
  const ctxSuffix = ctxBits.length > 0 ? ` [${ctxBits.join(", ")}]` : "";
  opts.logger.info(
    `launching headless claude resolver (cwd=${opts.worktreePath}, timeout=${timeout}s)${ctxSuffix}…`,
  );
  opts.logger.info(`  claude output follows:`);
  opts.logger.info(`  ${"─".repeat(60)}`);

  const exitCode = await runHeadlessClaude(prompt, opts.worktreePath, timeout, opts.logger, {
    addDirs: opts.addDirs,
    mcpConfig: opts.mcpConfig,
  });

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
