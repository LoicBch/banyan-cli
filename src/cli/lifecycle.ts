/**
 * Per-project lifecycle commands: workspace + feature start/stop, attach,
 * detach, info, status, resume, ports, ls-features, deploy.
 */
import type { Command } from "commander";
import type { Config, ProjectConfig } from "../config.js";
import { buildContext } from "../context.js";
import { logger } from "../logger.js";
import { resolveLocation } from "../commands/whereami.js";
import { info } from "../commands/info.js";
import { start } from "../commands/start.js";
import { stop } from "../commands/stop.js";
import { attach } from "../commands/attach.js";
import { detach } from "../commands/detach.js";
import { status } from "../commands/status.js";
import { test as testCmd } from "../commands/test.js";
import { testStop } from "../commands/testStop.js";
import { testLs } from "../commands/testLs.js";
import { ports as portsCmd } from "../commands/ports.js";
import { resume as resumeCmd } from "../commands/resume.js";
import { sync as syncCmd } from "../commands/sync.js";
import { pulse as pulseCmd } from "../commands/pulse.js";
import { deploy } from "../commands/deploy.js";
import { reportsLs } from "../commands/reportsLs.js";
import { agentPrompt } from "../commands/agentPrompt.js";
import { todoCmd } from "../commands/todo.js";

export function register(
  projectCmd: Command,
  project: ProjectConfig,
  config: Config,
): void {
  projectCmd
    .command("info")
    .description("show project details (layout, repos)")
    .action(async () => {
      await info(await buildContext(config, project.name));
    });

  projectCmd
    .command("start [feature] [repos...]")
    .description(
      "no args from project root: launch the project tmux workspace (orchestrator + terminal). " +
        "no args from a worktree dir: start/restart the feature inferred from cwd. " +
        "with <feature>: start (or restart if already up) every repo's run command for that feature. " +
        "with <feature> <repo...>: start/restart only those repos.",
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
    .command("stop [feature]")
    .description(
      "no args: kill the entire project tmux session. " +
        "with <feature>: stop only that feature's run processes (kills its test window).",
    )
    .action(async (feature: string | undefined) => {
      if (feature) {
        await testStop(await buildContext(config, project.name), feature);
      } else {
        await stop(await buildContext(config, project.name));
      }
    });

  projectCmd
    .command("attach")
    .description("attach to the tmux session")
    .action(async () => {
      const code = await attach(await buildContext(config, project.name));
      process.exit(code);
    });

  projectCmd
    .command("detach")
    .description("detach clients from the tmux session")
    .action(async () => {
      await detach(await buildContext(config, project.name));
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
    .command("ls-features")
    .description("list features that currently have a running test window")
    .action(async () => {
      await testLs(await buildContext(config, project.name));
    });

  projectCmd
    .command("pulse")
    .description(
      "real-time conflict-risk dashboard across active features. " +
        "shows file × feature matrix, overlaps, complexity scores, and a suggested merge order.",
    )
    .option("-b, --base <branch>", "override base branch")
    .option("-w, --watch <seconds>", "refresh every N seconds (live mode)", (v) => parseInt(v, 10))
    .action(async (opts: { base?: string; watch?: number }) => {
      await pulseCmd(config, project.name, { base: opts.base, watch: opts.watch });
    });

  projectCmd
    .command("sync")
    .description(
      "rebase every active feature on its base branch in one shot. " +
        "Uses the headless claude resolver (with cross-feature context) on conflicts.",
    )
    .option("-b, --base <branch>", "override base branch (default: per-repo baseBranch / origin/HEAD / main)")
    .option("--push", "push --force-with-lease after each successful rebase")
    .option("--skip-resolver", "don't auto-resolve conflicts; pause and report")
    .action(async (opts: { base?: string; push?: boolean; skipResolver?: boolean }) => {
      await syncCmd(config, project.name, {
        base: opts.base,
        push: opts.push,
        skipResolver: opts.skipResolver,
      });
    });

  projectCmd
    .command("ports [feature]")
    .description(
      "show port allocations: run ports (back/front/...) from the last `bn start` and live compose ports (DB/PMA/...). " +
        "no feature: cwd-inferred or all features with recorded state.",
    )
    .action(async (feature: string | undefined) => {
      await portsCmd(config, project.name, feature);
    });

  projectCmd
    .command("reports [feature]")
    .description(
      "show end-of-task reports submitted by per-feature agents (timeline). " +
        "no feature: all reports. with <feature>: just that feature's history.",
    )
    .option("--since <iso>", "only reports submitted at-or-after this ISO timestamp")
    .option("--latest", "one entry per feature (the latest)")
    .option("--json", "emit raw JSON (one record per line in --watch mode)")
    .option("-w, --watch", "tail new reports as they arrive (Ctrl+C to stop)")
    .option("--no-notify", "in --watch mode, suppress the macOS notification")
    .action(
      async (
        feature: string | undefined,
        opts: {
          since?: string;
          latest?: boolean;
          json?: boolean;
          watch?: boolean;
          notify?: boolean;
        },
      ) => {
        await reportsLs(project.name, {
          feature,
          since: opts.since,
          latestOnly: opts.latest,
          json: opts.json,
          watch: opts.watch,
          notify: opts.notify,
        });
      },
    );

  projectCmd
    .command("todo <feature>")
    .description(
      "view or edit the TODO list for a feature. " +
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
        feature: string,
        opts: {
          set?: string[];
          add?: string[];
          done?: string[];
          undone?: string[];
          rm?: string[];
          json?: boolean;
        },
      ) => {
        await todoCmd(project.name, feature, opts);
      },
    );

  projectCmd
    .command("agent-prompt")
    .description(
      "view or edit the per-mode agent system prompt for this project. " +
        "stored at ~/.config/banyan/<project>.agentprompt.<mode>.md (per-mode override), " +
        "falls back to the baked-in default for that mode. " +
        "interactive mode has no prompt (banyan injects nothing).",
    )
    .option(
      "-m, --mode <mode>",
      "which mode's prompt: assisted | autonomous | autopilot (default: autonomous)",
    )
    .option("-e, --edit", "open the per-project per-mode file in $EDITOR")
    .option("--default", "print the baked-in default instead of the per-project file")
    .option("--rendered", "substitute {{project}}/{{feature}} placeholders for preview")
    .action(
      async (opts: {
        mode?: string;
        edit?: boolean;
        default?: boolean;
        rendered?: boolean;
      }) => {
        await agentPrompt(project.name, opts);
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
