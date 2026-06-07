/**
 * Per-project lifecycle commands: workspace + feature start/stop, status,
 * resume, ports, deploy.
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
import { deploy } from "../commands/deploy.js";
import { todoCmd } from "../commands/todo.js";
import { approveCmd } from "../commands/approve.js";

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
    .command("approve [branch]")
    .description(
      "approve (or reject) whatever's pending for this branch — the plan if a plan-review gate is open, " +
        "otherwise the latest report. branch is inferred from cwd when omitted in a worktree. " +
        "without flags: approve. with --reject: reject (agent revises). with --show: read current state, no mutation.",
    )
    .option("--reject [reason]", "reject (the plan or report — whichever is pending) instead of approving")
    .option("--show", "show plan + report state without mutating")
    .action(
      async (
        feature: string | undefined,
        opts: { reject?: string | boolean; show?: boolean },
      ) => {
        const feat = resolveFeatureFromCwd(config, project.name, feature, "approve");
        await approveCmd(config, project.name, feat, opts);
      },
    );

  projectCmd
    .command("todo [branch]")
    .description(
      "view or edit the TODO list for a feature. branch is inferred from cwd when omitted in a worktree. " +
        "no flags = show. --set replaces the list, --add appends, --done/--undone toggles by id, --rm deletes. " +
        "ids are auto-assigned (1..N) and never reused.",
    )
    .option("--set <items...>", "replace the entire list with these items")
    .option("--add <items...>", "append these items to the list")
    .option("--done <ids...>", "mark these item ids as done")
    .option("--undone <ids...>", "mark these item ids as not done")
    .option("--rm <ids...>", "delete these item ids")
    .option("--json", "emit raw JSON")
    .action(
      async (
        feature: string | undefined,
        opts: {
          set?: string[];
          add?: string[];
          done?: string[];
          undone?: string[];
          rm?: string[];
          json?: boolean;
        },
      ) => {
        const feat = resolveFeatureFromCwd(config, project.name, feature, "todo");
        await todoCmd(config, project.name, feat, opts);
      },
    );

  projectCmd
    .command("deploy [repo] [args...]")
    .description("run the deployCommand for the project (or a specific repo). extra args pass through to the command")
    .allowUnknownOption()
    .action(async (repoName: string | undefined, args: string[]) => {
      const code = await deploy(config, project.name, repoName, args);
      if (code !== 0) process.exit(code);
    });
}
