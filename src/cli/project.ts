/**
 * Per-project command registration. Each project in the config gets its own
 * top-level command (`bn <project> ...`) — this module wires up its full
 * subcommand tree by delegating to focused registrar files.
 */
import type { Command } from "commander";
import type { Config } from "../config.js";

import * as lifecycle from "./lifecycle.js";
import * as worktree from "./worktree.js";
import * as env from "./env.js";
import * as ask from "./ask.js";

export function registerProjectCommands(program: Command, config: Config): void {
  for (const project of config.projects) {
    const projectCmd = program
      .command(project.name)
      .description(`manage the '${project.name}' workspace`);

    lifecycle.register(projectCmd, project, config);
    worktree.register(projectCmd, project, config);
    env.register(projectCmd, project, config);
    ask.register(projectCmd, project, config);
  }
}
