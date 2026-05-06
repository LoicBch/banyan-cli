/**
 * Per-project orchestrator command + subcommands.
 */
import type { Command } from "commander";
import type { Config, ProjectConfig } from "../config.js";
import { buildContext } from "../context.js";
import * as orchestrator from "../commands/orchestrator.js";

export function register(
  projectCmd: Command,
  project: ProjectConfig,
  config: Config,
): void {
  const orchCmd = projectCmd
    .command("orchestrator")
    .description(
      "spawn a project-wide claude agent with --add-dir on every repo's parent dir + banyan MCP wired in. coexists with per-feature panes.",
    )
    .action(async () => {
      const code = await orchestrator.start(await buildContext(config, project.name));
      process.exit(code);
    });

  orchCmd
    .command("start")
    .description("start (or attach if running) the orchestrator")
    .action(async () => {
      const code = await orchestrator.start(await buildContext(config, project.name));
      process.exit(code);
    });

  orchCmd
    .command("stop")
    .description("kill the orchestrator window (drops --continue marker)")
    .action(async () => {
      await orchestrator.stop(await buildContext(config, project.name));
    });

  orchCmd
    .command("status")
    .description("report whether the orchestrator window is up")
    .action(async () => {
      await orchestrator.status(await buildContext(config, project.name));
    });
}
