/**
 * Per-project lifecycle commands: workspace + feature start/stop, status,
 * resume, ports.
 */
import type { Command } from "commander";
import type { Config, ProjectConfig } from "../config.js";
import { buildContext } from "../context.js";
import { logger } from "../logger.js";
import { resolveLocation, resolveFeatureFromCwd } from "../location.js";
import { start } from "../commands/start.js";
import { stop } from "../commands/stop.js";
import { status } from "../commands/status.js";
import { test as testCmd } from "../commands/test.js";
import { testStop } from "../commands/testStop.js";
import { ports as portsCmd } from "../commands/ports.js";
import { resume as resumeCmd } from "../commands/resume.js";
import { restartOrchestrator } from "../commands/restartOrchestrator.js";
import { broadcast as broadcastCmd } from "../commands/broadcast.js";

export function register(
  projectCmd: Command,
  project: ProjectConfig,
  config: Config,
): void {
  projectCmd
    .command("start [branch] [repos...]")
    .description(
      "no args from project root: launch the project tmux workspace (orchestrator + terminal). " +
        "no args from a worktree dir: start/restart the run stack for the inferred branch. " +
        "with <branch>: start (or restart if already up) every repo's run command on that branch. " +
        "<branch> can be a feature short name (`bn start login` after `bn wt login`), " +
        "a base branch checked out in the main repo (`bn start develop`), or any full branch name. " +
        "with <branch> <repo...>: start/restart only those repos.",
    )
    .action(async (feature: string | undefined, repos: string[]) => {
      if (!feature) {
        const loc = resolveLocation(config, process.cwd());
        if (loc?.feature && loc.project.name === project.name) {
          logger.info(`inferred feature '${loc.feature}' from cwd`);
          await testCmd(config, project.name, loc.feature, undefined);
          return;
        }
        const code = await start(await buildContext(config, project.name));
        process.exit(code);
      }
      await testCmd(config, project.name, feature, repos.length > 0 ? repos : undefined);
    });

  projectCmd
    .command("stop [branch]")
    .description(
      "stop a branch's run processes (kills its test-<branch> window). " +
        "branch is inferred from cwd when omitted in a worktree. " +
        "the agent pane and the project session are left running. " +
        "use `bn <project> close` to tear down the whole session.",
    )
    .action(async (feature: string | undefined) => {
      const feat = resolveFeatureFromCwd(config, project.name, feature, "stop");
      await testStop(await buildContext(config, project.name), feat);
    });

  projectCmd
    .command("close")
    .description(
      "close the project tmux session — orchestrator, agents, all running " +
        "test windows. worktrees, branches, agent state, reports, todos, " +
        "and compose volumes on disk are kept; `bn <project> start` brings " +
        "everything back. for full teardown of a feature use " +
        "`bn <project> cleanup <feature>`.",
    )
    .action(async () => {
      await stop(await buildContext(config, project.name));
    });

  projectCmd
    .command("status")
    .description("show session status and windows")
    .action(async () => {
      await status(await buildContext(config, project.name));
    });

  projectCmd
    .command("resume")
    .description(
      "restore the project after a reboot: relaunch the workspace, recreate the agent pane for every feature with an existing worktree (each Claude resumes its prior conversation), and relaunch run processes for features that had a previous `bn start`.",
    )
    .action(async () => {
      await resumeCmd(config, project.name);
    });

  projectCmd
    .command("restart-orchestrator")
    .description(
      "respawn just the orchestrator pane: kills the current process in it and relaunches claude with the full system prompt + MCP config + parent dirs + --continue. " +
        "use after the orchestrator's claude exited or got replaced. " +
        "other panes, feature agents, and run stacks are untouched.",
    )
    .action(async () => {
      await restartOrchestrator(await buildContext(config, project.name));
    });

  projectCmd
    .command("ports [branch]")
    .description(
      "show port allocations: run ports (back/front/...) from the last `bn start` and live compose ports (DB/PMA/...). " +
        "no feature: cwd-inferred or all features with recorded state.",
    )
    .action(async (feature: string | undefined) => {
      await portsCmd(config, project.name, feature);
    });

  projectCmd
    .command("broadcast <prompt>")
    .description(
      "send the same prompt to every live feature agent in the project, in one shot. " +
        "skips reserved panes (ops / orchestrator / terminal) automatically. " +
        "use `--only` to target specific features or `--exclude` to skip some.",
    )
    .option("--only <features>", "comma-separated list of feature tags to target")
    .option("--exclude <features>", "comma-separated list of feature tags to skip")
    .option(
      "--force",
      "send even to panes where claude isn't detected as running (default: those panes are skipped)",
    )
    .action(
      async (
        prompt: string,
        opts: { only?: string; exclude?: string; force?: boolean },
      ) => {
        const parseList = (v: string | undefined): string[] =>
          v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
        const result = await broadcastCmd(config, project.name, prompt, {
          only: parseList(opts.only),
          exclude: parseList(opts.exclude),
          force: opts.force,
        });
        if (result.sent.length === 0) {
          logger.warn(`no panes received the broadcast`);
        } else {
          logger.ok(`broadcast sent to ${result.sent.length} feature${result.sent.length > 1 ? "s" : ""}: ${result.sent.join(", ")}`);
        }
        for (const s of result.skipped) {
          logger.info(`  skipped ${s.feature}: ${s.reason}`);
        }
      },
    );
}
