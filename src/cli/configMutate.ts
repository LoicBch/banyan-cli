/**
 * Per-project config-mutation commands: add-repo, remove-repo, remove,
 * set-layout, set-base, set-run.
 */
import type { Command } from "commander";
import type { Config, ProjectConfig } from "../config.js";
import { addRepo } from "../commands/addRepo.js";
import { removeRepo } from "../commands/removeRepo.js";
import { removeProject } from "../commands/removeProject.js";
import { setLayout } from "../commands/setLayout.js";
import { setBase } from "../commands/setBase.js";
import { setRun } from "../commands/setRun.js";

export function register(
  projectCmd: Command,
  project: ProjectConfig,
  config: Config,
): void {
  projectCmd
    .command("add-repo <name> [path]")
    .description("add a repo to this project (path defaults to cwd)")
    .action(async (name: string, repoPath?: string) => {
      await addRepo(config, project.name, name, repoPath);
    });

  projectCmd
    .command("remove-repo <name>")
    .description("remove a repo from this project")
    .action(async (name: string) => {
      await removeRepo(config, project.name, name);
    });

  projectCmd
    .command("remove")
    .description("remove this project from config (repos untouched)")
    .action(async () => {
      await removeProject(config, project.name);
    });

  projectCmd
    .command("set-layout <path>")
    .description("set or change the layout script path")
    .action(async (layoutPath: string) => {
      await setLayout(config, project.name, layoutPath);
    });

  projectCmd
    .command("set-base <repo> <branch>")
    .description("set the default base branch used by merge/rebase for a repo")
    .action(async (repoName: string, branch: string) => {
      await setBase(config, project.name, repoName, branch);
    });

  projectCmd
    .command("set-run <repo>")
    .description("set or show run config for a repo (command/port/portEnv)")
    .option("-c, --command <cmd>", "command to launch in the worktree")
    .option("-p, --port <number>", "canonical port (used as base for free-port search)", (v) => parseInt(v, 10))
    .option("--port-env <name>", "env var name to inject the port as")
    .option("--setup <cmd>", "command to run once before the main run command (e.g., npm install)")
    .option("--clear", "remove the run config")
    .action(async (repoName: string, opts: { command?: string; port?: number; portEnv?: string; setup?: string; clear?: boolean }) => {
      await setRun(config, project.name, repoName, opts);
    });
}
