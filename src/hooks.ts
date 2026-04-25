/**
 * Hooks subsystem — inspired by dmux (MIT, formkit/dmux).
 *
 * Banyan invokes user-provided shell scripts at key lifecycle points so anyone
 * can plug custom logic (deploy a preview env, post to Slack, run extra
 * validation, etc.) without modifying banyan core.
 *
 * Hook script lookup, in order:
 *   1. <projectMainRepo>/.banyan-hooks/<hookName>   ← team, versioned
 *   2. <projectMainRepo>/.banyan/hooks/<hookName>   ← local override (gitignored)
 *   3. ~/.banyan/hooks/<hookName>                   ← global per-user
 *
 * The first executable file wins. Hooks must be `chmod +x`.
 *
 * The hook process inherits stdio (stdout/stderr stream live to banyan's
 * terminal) and receives a rich `BANYAN_*` env block plus all parent env.
 */

import { existsSync, accessSync, constants as fsConst } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ProjectConfig, RepoConfig } from "./config.js";
import { logger } from "./logger.js";

export type HookName =
  | "worktree_created"
  | "before_worktree_remove"
  | "worktree_removed"
  | "stack_up"
  | "stack_down"
  | "pre_merge"
  | "post_merge"
  | "pre_test"
  | "post_test";

export interface HookEnv {
  BANYAN_PROJECT: string;
  BANYAN_FEATURE?: string;
  BANYAN_REPO?: string;
  BANYAN_REPO_PATH?: string;
  BANYAN_WORKTREE_PATH?: string;
  BANYAN_BRANCH?: string;
  BANYAN_BASE_BRANCH?: string;
  /** Catch-all for ad-hoc data (e.g. allocated ports). */
  [key: string]: string | undefined;
}

/** Locate the script for `name`, searching the 3 standard layers. */
export function findHook(projectMainRepo: string, name: HookName): string | null {
  const candidates = [
    path.join(projectMainRepo, ".banyan-hooks", name),
    path.join(projectMainRepo, ".banyan", "hooks", name),
    path.join(homedir(), ".banyan", "hooks", name),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      accessSync(p, fsConst.X_OK);
      return p;
    } catch {
      logger.warn(
        `hook "${name}" exists at ${p} but is not executable — chmod +x ${p}`,
      );
    }
  }
  return null;
}

/**
 * Run a hook if it exists. Streams stdio to banyan's terminal.
 * Resolves with the exit code (0 if no hook). Never throws — hooks are
 * advisory, banyan keeps running on hook failure (just warns).
 */
export async function runHook(
  projectMainRepo: string,
  name: HookName,
  env: HookEnv,
): Promise<number> {
  const script = findHook(projectMainRepo, name);
  if (!script) return 0;

  logger.info(`hook: ${name} (${script})`);
  return new Promise((resolve) => {
    // Filter undefined values out of env; spawn rejects them.
    const safeEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
    };
    for (const [k, v] of Object.entries(env)) {
      if (v !== undefined) safeEnv[k] = v;
    }
    const child = spawn(script, [], {
      cwd: projectMainRepo,
      env: safeEnv,
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", (err) => {
      logger.warn(`hook ${name} spawn error: ${err.message}`);
      resolve(1);
    });
    child.on("close", (code) => {
      const c = code ?? 1;
      if (c !== 0) logger.warn(`hook ${name} exited with code ${c}`);
      resolve(c);
    });
  });
}

/** Convenience: build the standard env block from a project + repo + feature. */
export function buildHookEnv(args: {
  project: ProjectConfig;
  repo?: RepoConfig;
  feature?: string;
  worktreePath?: string;
  branch?: string;
  baseBranch?: string;
  extra?: Record<string, string>;
}): HookEnv {
  const env: HookEnv = {
    BANYAN_PROJECT: args.project.name,
  };
  if (args.feature) env.BANYAN_FEATURE = args.feature;
  if (args.repo) {
    env.BANYAN_REPO = args.repo.name;
    env.BANYAN_REPO_PATH = args.repo.path;
  }
  if (args.worktreePath) env.BANYAN_WORKTREE_PATH = args.worktreePath;
  if (args.branch) env.BANYAN_BRANCH = args.branch;
  if (args.baseBranch) env.BANYAN_BASE_BRANCH = args.baseBranch;
  if (args.extra) {
    for (const [k, v] of Object.entries(args.extra)) env[k] = v;
  }
  return env;
}
