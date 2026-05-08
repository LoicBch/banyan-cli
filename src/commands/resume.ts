/**
 * `bn <proj> resume` — restore a project's full working state after a reboot
 * or fresh shell.
 *
 * Workflow:
 *   1. Launch the workspace (orchestrator pane). The orchestrator's Claude
 *      session is preserved across restarts via its marker file.
 *   2. For every feature with an existing worktree on disk, call `wtAll` to
 *      recreate its agent pane(s) in the agents-<project> tmux window.
 *      Each per-feature Claude pane resumes its prior conversation via
 *      `claude --continue` (cwd-keyed).
 *   3. For every feature that had recorded port state (i.e. a previous
 *      `bn start <feature>`), relaunch the run commands so back/front/app
 *      processes come back up and adb-reverse is wired again.
 *
 * Worktrees are filesystem-persistent so step 2 always finds them. Compose
 * stacks may already be up if Docker had `restart: unless-stopped`; up() is
 * idempotent so it's a no-op then.
 */
import { getProject, type Config } from "../config.js";
import * as git from "../git.js";
import * as naming from "../naming.js";
import * as state from "../state.js";
import { readAgentState } from "../agentState.js";
import { buildContext } from "../context.js";
import { start } from "./start.js";
import { wtAll } from "./wtAll.js";
import { test as testCmd } from "./test.js";
import { logger } from "../logger.js";

export async function resume(config: Config, projectName: string): Promise<void> {
  const project = getProject(config, projectName);

  // ── Step 1: Discover active features by scanning worktrees on disk ──────
  const features = new Set<string>();
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    const wts = await git.worktreeList(repo.path).catch(() => []);
    for (const wt of wts) {
      if (wt.path === repo.path) continue;
      const parsed = naming.parseWorktreePath(wt.path, repo.path);
      if (parsed) features.add(parsed.feature);
    }
  }

  logger.info(
    `resuming '${projectName}': ${features.size > 0 ? `${features.size} feature${features.size > 1 ? "s" : ""} found` : "no active features"}`,
  );

  // ── Step 2: Launch the workspace (orchestrator + terminal) ──────────────
  // start() builds the native workspace. Idempotent — if the workspace
  // window already exists it just attaches.
  // Note: start() returns an exit code and may attach to tmux. To avoid that
  // here we skip the actual workspace start when there's nothing to resume,
  // but otherwise we must defer to the user — running start() inline would
  // attach and prevent the rest of resume from running.
  // So: we call wtAll + testCmd FIRST (which create panes in the session),
  // then call start() last so it attaches to the now-fully-restored session.

  // ── Step 3: Recreate agent panes per feature ────────────────────────────
  // For each feature, look up the persisted launch options (mode +
  // requireApproval) from <project>.<feature>.agent.json. If absent
  // (feature predates this state file), fall back to the legacy default —
  // 'interactive' since that's what resume used to do, with a warning so
  // the user knows the agent isn't in its original mode.
  for (const feature of features) {
    logger.info("");
    const agentSt = readAgentState(projectName, feature);
    const modeLabel = agentSt
      ? `${agentSt.mode}${agentSt.requireApproval ? " + plan-review" : ""}`
      : "interactive (no recorded mode — original mode unknown)";
    logger.info(`── recreating agent pane for '${feature}' (${modeLabel}) ──`);
    if (!agentSt) {
      logger.warn(
        `no recorded agent state for '${feature}'; resuming as interactive. ` +
          `if this feature was originally autopilot/autonomous, run ` +
          `\`bn ${projectName} cleanup ${feature}\` and recreate it explicitly.`,
      );
    }
    try {
      await wtAll(config, projectName, feature, {
        ...(agentSt ? { mode: agentSt.mode } : {}),
        ...(agentSt?.requireApproval ? { requireApproval: true } : {}),
      });
    } catch (err) {
      logger.warn(
        `failed to recreate agent pane for '${feature}': ${(err as Error).message}`,
      );
    }
  }

  // ── Step 4: Relaunch run commands for features that had recorded state ──
  for (const feature of features) {
    const fs = state.readFeatureState(projectName, feature);
    if (!fs) {
      logger.info(`'${feature}': no run-port state recorded; skipping process relaunch`);
      continue;
    }
    logger.info("");
    logger.info(`── relaunching run commands for '${feature}' ──`);
    try {
      await testCmd(config, projectName, feature);
    } catch (err) {
      logger.warn(
        `failed to relaunch '${feature}' processes: ${(err as Error).message}`,
      );
    }
  }

  // ── Step 5: Launch the workspace (will attach if running interactively) ─
  logger.info("");
  logger.info(`── launching workspace ──`);
  const code = await start(await buildContext(config, projectName));
  if (code !== 0) process.exit(code);
}
