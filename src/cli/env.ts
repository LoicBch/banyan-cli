/**
 * Per-project env (docker compose) commands.
 */
import type { Command } from "commander";
import type { Config, ProjectConfig } from "../config.js";
import {
  envLs,
  envLogs,
  envExec,
  envRecreate,
  envUp,
  envDown,
} from "../commands/env.js";

export function register(
  projectCmd: Command,
  project: ProjectConfig,
  config: Config,
): void {
  const envCmd = projectCmd
    .command("env")
    .description("manage docker-compose stacks for the project's compose-type repos");

  envCmd
    .command("ls")
    .description("list active compose stacks for this project")
    .action(async () => {
      await envLs(config, project.name);
    });

  envCmd
    .command("logs <branch> [service]")
    .description("tail logs of a compose stack (optionally filtered to a single service)")
    .action(async (feature: string, service: string | undefined) => {
      await envLogs(config, project.name, feature, service);
    });

  envCmd
    .command("exec <branch> <service> [command...]")
    .description("exec into a service (defaults to sh)")
    .action(async (feature: string, service: string, command: string[]) => {
      await envExec(config, project.name, feature, service, command);
    });

  envCmd
    .command("recreate <branch>")
    .description("down -v + up (reset volumes for a fresh DB)")
    .action(async (feature: string) => {
      await envRecreate(config, project.name, feature);
    });

  envCmd
    .command("up <branch>")
    .description("start compose stacks for a feature without touching git worktrees")
    .action(async (feature: string) => {
      await envUp(config, project.name, feature);
    });

  envCmd
    .command("down <branch>")
    .description("stop compose stacks for a feature (volumes kept)")
    .action(async (feature: string) => {
      await envDown(config, project.name, feature);
    });
}
