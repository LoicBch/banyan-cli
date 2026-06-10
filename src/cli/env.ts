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
import { resolveFeatureFromCwd } from "../location.js";

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
    .command("logs [branch] [service]")
    .description("tail logs of a compose stack (optionally filtered to a single service). branch is inferred from cwd when omitted in a worktree.")
    .action(async (feature: string | undefined, service: string | undefined) => {
      const feat = resolveFeatureFromCwd(config, project.name, feature, "env logs");
      await envLogs(config, project.name, feat, service);
    });

  envCmd
    .command("exec <branch> <service> [command...]")
    .description("exec into a service (defaults to sh)")
    .action(async (feature: string, service: string, command: string[]) => {
      await envExec(config, project.name, feature, service, command);
    });

  envCmd
    .command("recreate [branch]")
    .description("down -v + up (reset volumes for a fresh DB). branch is inferred from cwd when omitted in a worktree.")
    .action(async (feature: string | undefined) => {
      const feat = resolveFeatureFromCwd(config, project.name, feature, "env recreate");
      await envRecreate(config, project.name, feat);
    });

  envCmd
    .command("up [branch]")
    .description("start compose stacks for a feature without touching git worktrees. branch is inferred from cwd when omitted in a worktree.")
    .action(async (feature: string | undefined) => {
      const feat = resolveFeatureFromCwd(config, project.name, feature, "env up");
      await envUp(config, project.name, feat);
    });

  envCmd
    .command("down [branch]")
    .description("stop compose stacks for a feature (volumes kept). branch is inferred from cwd when omitted in a worktree.")
    .action(async (feature: string | undefined) => {
      const feat = resolveFeatureFromCwd(config, project.name, feature, "env down");
      await envDown(config, project.name, feat);
    });
}
