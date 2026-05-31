import type { Config } from "../config.js";
import { getProject, getRepo } from "../config.js";
import { buildContext } from "../context.js";
import { logger } from "../logger.js";
import { BanyanError } from "../errors.js";
import * as naming from "../naming.js";
import * as docker from "../docker.js";
import { test as testCmd } from "../commands/test.js";
import { testStop } from "../commands/testStop.js";
import { cleanup } from "../commands/cleanup.js";
import { merge as mergeCmd } from "../commands/merge.js";
import { rebase as rebaseCmd } from "../commands/rebase.js";
import { resolveRepos } from "../context.js";
import { detectProvider } from "../pr/detect.js";
import type { MRStatus } from "../pr/types.js";

export interface ActionResult {
  ok: boolean;
  logs: LogLine[];
  error?: string;
}

export interface LogLine {
  level: "info" | "ok" | "warn" | "error";
  message: string;
}

/**
 * Dashboard actions mutate shared state (tmux, docker, filesystem). We serialize
 * them through a simple FIFO so two concurrent requests don't race on the same
 * logger swap or on conflicting tmux windows.
 */
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

/**
 * Run `fn` while capturing everything written to the shared logger. The swap
 * is global, so we rely on `serialize()` to prevent interleaving.
 */
async function captureAction(fn: () => Promise<void>): Promise<ActionResult> {
  const logs: LogLine[] = [];
  const original = {
    info: logger.info,
    ok: logger.ok,
    warn: logger.warn,
    error: logger.error,
  };
  logger.info = (m: string) => logs.push({ level: "info", message: m });
  logger.ok = (m: string) => logs.push({ level: "ok", message: m });
  logger.warn = (m: string) => logs.push({ level: "warn", message: m });
  logger.error = (m: string) => logs.push({ level: "error", message: m });

  try {
    await fn();
    return { ok: true, logs };
  } catch (err) {
    const msg =
      err instanceof BanyanError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, logs, error: msg };
  } finally {
    logger.info = original.info;
    logger.ok = original.ok;
    logger.warn = original.warn;
    logger.error = original.error;
  }
}

export interface TestStartParams {
  project: string;
  feature: string;
  repos?: string[];
}

export function actionTestStart(
  config: Config,
  p: TestStartParams,
): Promise<ActionResult> {
  return serialize(() =>
    captureAction(async () => {
      await testCmd(config, p.project, p.feature, p.repos);
    }),
  );
}

export interface TestStopParams {
  project: string;
  feature: string;
}

export function actionTestStop(
  config: Config,
  p: TestStopParams,
): Promise<ActionResult> {
  return serialize(() =>
    captureAction(async () => {
      await testStop(await buildContext(config, p.project), p.feature);
    }),
  );
}

export interface CleanupParams {
  project: string;
  feature: string;
  /** Single repo to clean up. Omit for feature-wide cleanup (every repo + compose stacks). */
  repo?: string;
  force?: boolean;
}

export function actionCleanup(
  config: Config,
  p: CleanupParams,
): Promise<ActionResult> {
  return serialize(() =>
    captureAction(async () => {
      const project = getProject(config, p.project);
      const repoNames = await resolveRepos(project, p.feature, p.repo, { includeCompose: !p.repo });
      for (const r of repoNames) {
        if (repoNames.length > 1) logger.info(`=== ${r} ===`);
        await cleanup(
          await buildContext(config, p.project, { feature: p.feature, repoName: r }),
          p.force ? { force: true } : {},
        );
      }
    }),
  );
}

export interface MergeParams {
  project: string;
  feature: string;
  /** Single repo to merge. Omit to merge every git repo of the feature. */
  repo?: string;
  local?: boolean;
  draft?: boolean;
  wait?: boolean;
  noResolve?: boolean;
}

export function actionMerge(
  config: Config,
  p: MergeParams,
): Promise<ActionResult> {
  return serialize(() =>
    captureAction(async () => {
      const project = getProject(config, p.project);
      const repoNames = await resolveRepos(project, p.feature, p.repo);
      for (const r of repoNames) {
        if (repoNames.length > 1) logger.info(`=== ${r} ===`);
        await mergeCmd(
          await buildContext(config, p.project, { feature: p.feature, repoName: r }),
          {
            local: p.local,
            draft: p.draft,
            wait: p.wait,
            noResolve: p.noResolve,
          },
        );
      }
    }),
  );
}

export interface RebaseParams {
  project: string;
  feature: string;
  /** Single repo to rebase. Omit to rebase every git repo of the feature. */
  repo?: string;
  base?: string;
}

export function actionRebase(
  config: Config,
  p: RebaseParams,
): Promise<ActionResult> {
  return serialize(() =>
    captureAction(async () => {
      const project = getProject(config, p.project);
      const repoNames = await resolveRepos(project, p.feature, p.repo);
      for (const r of repoNames) {
        if (repoNames.length > 1) logger.info(`=== ${r} ===`);
        await rebaseCmd(
          await buildContext(config, p.project, { feature: p.feature, repoName: r }),
          p.base ? { base: p.base } : {},
        );
      }
    }),
  );
}

export interface EnvParams {
  project: string;
  feature: string;
  /** Optional: name of the compose repo (defaults to the first compose repo in project). */
  repo?: string;
}

function resolveComposeRepo(config: Config, p: EnvParams) {
  const project = getProject(config, p.project);
  if (p.repo) {
    const r = getRepo(project, p.repo);
    if (r.type !== "compose") {
      throw new BanyanError(`repo "${r.name}" is not a compose repo`);
    }
    return { project, repo: r };
  }
  const first = project.repos.find((r) => r.type === "compose");
  if (!first) throw new BanyanError(`no compose repo in project "${project.name}"`);
  return { project, repo: first };
}

export function actionEnvUp(config: Config, p: EnvParams): Promise<ActionResult> {
  return serialize(() =>
    captureAction(async () => {
      const { project, repo } = resolveComposeRepo(config, p);
      logger.info(`docker compose up for ${repo.name} (${p.feature})…`);
      await docker.up(repo, project, p.feature);
      logger.ok(`stack up: ${docker.composeProjectName(project, p.feature)}`);
    }),
  );
}

export function actionEnvDown(config: Config, p: EnvParams): Promise<ActionResult> {
  return serialize(() =>
    captureAction(async () => {
      const { project, repo } = resolveComposeRepo(config, p);
      logger.info(`docker compose down for ${repo.name} (${p.feature})…`);
      await docker.down(repo, project, p.feature);
      logger.ok(`stack stopped (volumes kept)`);
    }),
  );
}

export function actionEnvRecreate(
  config: Config,
  p: EnvParams,
): Promise<ActionResult> {
  return serialize(() =>
    captureAction(async () => {
      const { project, repo } = resolveComposeRepo(config, p);
      logger.info(`recreating stack (down -v + up) for ${repo.name} (${p.feature})…`);
      await docker.recreate(repo, project, p.feature);
      logger.ok(`stack recreated fresh`);
    }),
  );
}

export interface MrStatusParams {
  project: string;
  repo: string;
  feature: string;
}

export interface MrStatusResult {
  ok: boolean;
  status?: MRStatus;
  provider?: string;
  branch: string;
  error?: string;
}

/**
 * Query the MR/PR status for a worktree's branch. Not serialized — this is
 * read-only and safe to run concurrently.
 */
export async function actionMrStatus(
  config: Config,
  p: MrStatusParams,
): Promise<MrStatusResult> {
  try {
    const project = getProject(config, p.project);
    const repo = getRepo(project, p.repo);
    if (repo.type === "compose") {
      return { ok: false, branch: "", error: "compose repos have no MR" };
    }
    const branch = naming.branchName(p.feature);
    const worktreePath = naming.existingWorktreePath(repo.path, p.feature);
    if (!worktreePath) {
      return { ok: false, branch, error: `no worktree found for feature ${p.feature}` };
    }
    const provider = await detectProvider(repo.path);
    if (!provider) {
      return { ok: false, branch, error: "no supported provider for this remote" };
    }
    const notReady = await provider.checkReady();
    if (notReady) return { ok: false, branch, provider: provider.name, error: notReady };

    const status = await provider.status(repo.path, branch);
    return { ok: true, branch, provider: provider.name, status };
  } catch (err) {
    const msg =
      err instanceof BanyanError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { ok: false, branch: "", error: msg };
  }
}
