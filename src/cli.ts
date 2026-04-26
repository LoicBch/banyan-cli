import { Command } from "commander";
import { loadConfig, getProject, type Config } from "./config.js";
import { buildContext, resolveRepos } from "./context.js";
import { BanyanError } from "./errors.js";
import { logger } from "./logger.js";

import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { attach } from "./commands/attach.js";
import { detach } from "./commands/detach.js";
import { status } from "./commands/status.js";
import { wtRm } from "./commands/wtRm.js";
import { wtLs } from "./commands/wtLs.js";
import { rebase } from "./commands/rebase.js";
import { merge } from "./commands/merge.js";
import { cleanup } from "./commands/cleanup.js";
import { list } from "./commands/list.js";
import { info } from "./commands/info.js";
import { init } from "./commands/init.js";
import { addRepo } from "./commands/addRepo.js";
import { removeRepo } from "./commands/removeRepo.js";
import { removeProject } from "./commands/removeProject.js";
import { setLayout } from "./commands/setLayout.js";
import { setBase } from "./commands/setBase.js";
import { wtAll } from "./commands/wtAll.js";
import { test as testCmd } from "./commands/test.js";
import { testStop } from "./commands/testStop.js";
import { testLs } from "./commands/testLs.js";
import { setRun } from "./commands/setRun.js";
import { deploy } from "./commands/deploy.js";
import { sidebar } from "./commands/sidebar.js";
import { whereami } from "./commands/whereami.js";
import { envLs, envLogs, envExec, envRecreate, envUp, envDown } from "./commands/env.js";
import { serve } from "./commands/serve.js";
import * as orchestrator from "./commands/orchestrator.js";

export async function run(argv: string[]): Promise<number> {
  let config: Config;
  try {
    config = await loadConfig();
  } catch (err) {
    if (err instanceof BanyanError) {
      // allow `init` and `ls` even if config doesn't exist yet (ls just shows empty)
      if (argv[0] === "init" || argv[0] === "ls") {
        config = { version: 1, projects: [] };
      } else {
        logger.error(err.message);
        return 1;
      }
    } else {
      throw err;
    }
  }

  const program = new Command();
  program
    .name("banyan")
    .description("tmux + git worktrees + Claude Code, multi-repo per project")
    .version("0.2.0")
    .exitOverride();

  // top-level commands (no project)
  program
    .command("ls")
    .description("list all projects and their repos")
    .action(async () => {
      await list(config);
    });

  program
    .command("sidebar")
    .description("live tree view of projects / repos / worktrees / agents")
    .action(async () => {
      await sidebar(config);
    });

  program
    .command("whereami")
    .description("report banyan context (project/repo/feature) for the current cwd")
    .action(async () => {
      await whereami(config);
    });

  program
    .command("serve")
    .description("start the web dashboard (read-only overview of projects, worktrees, stacks)")
    .option("-p, --port <number>", "port to bind (default: first free from 4242)", (v) => parseInt(v, 10))
    .option("--no-open", "don't open the browser automatically")
    .action(async (opts: { port?: number; open?: boolean }) => {
      await serve(config, { port: opts.port, open: opts.open });
    });

  program
    .command("init <project>")
    .description("create a new project (cwd as first repo by default)")
    .option("-r, --repo-name <name>", "name for the first repo (default: basename of cwd)")
    .option("-p, --path <path>", "path of the first repo (default: cwd)")
    .option("-l, --layout <path>", "layout script path (optional)")
    .action(async (project: string, opts: { repoName?: string; path?: string; layout?: string }) => {
      await init(config, project, opts);
    });

  program
    .command("mcp-serve")
    .description(
      "start the banyan MCP server (stdio). Register in your MCP client to control banyan from an agent.",
    )
    .action(async () => {
      const { runMcpServer } = await import("./mcp/server.js");
      await runMcpServer();
    });

  program
    .command("mcp-log")
    .description("show recent banyan MCP tool calls (logged by `banyan mcp-serve`)")
    .option("-f, --follow", "tail the log live (Ctrl+C to stop)")
    .option(
      "-n, --lines <n>",
      "show the last N entries (default 50)",
      (v) => parseInt(v, 10),
    )
    .action(async (opts: { follow?: boolean; lines?: number }) => {
      const { mcpLog } = await import("./commands/mcpLog.js");
      await mcpLog({ follow: opts.follow, n: opts.lines });
    });

  // per-project commands
  for (const project of config.projects) {
    const projectCmd = program
      .command(project.name)
      .description(`manage the '${project.name}' workspace`);

    projectCmd
      .command("info")
      .description("show project details (layout, repos)")
      .action(async () => {
        await info(buildContext(config, project.name));
      });

    projectCmd
      .command("start")
      .description("launch the tmux layout")
      .action(async () => {
        const code = await start(buildContext(config, project.name));
        process.exit(code);
      });

    projectCmd
      .command("stop")
      .description("kill the tmux session")
      .action(async () => {
        await stop(buildContext(config, project.name));
      });

    projectCmd
      .command("attach")
      .description("attach to the tmux session")
      .action(async () => {
        const code = await attach(buildContext(config, project.name));
        process.exit(code);
      });

    projectCmd
      .command("detach")
      .description("detach clients from the tmux session")
      .action(async () => {
        await detach(buildContext(config, project.name));
      });

    projectCmd
      .command("status")
      .description("show session status and windows")
      .action(async () => {
        await status(buildContext(config, project.name));
      });

    // Orchestrator: optional cross-feature agent in its own tmux window.
    const orchCmd = projectCmd
      .command("orchestrator")
      .description(
        "spawn a project-wide claude agent with --add-dir on every repo's parent dir + banyan MCP wired in. coexists with per-feature panes.",
      )
      .action(async () => {
        // default action when no subcommand is given
        const code = await orchestrator.start(buildContext(config, project.name));
        process.exit(code);
      });
    orchCmd
      .command("start")
      .description("start (or attach if running) the orchestrator")
      .action(async () => {
        const code = await orchestrator.start(buildContext(config, project.name));
        process.exit(code);
      });
    orchCmd
      .command("stop")
      .description("kill the orchestrator window (drops --continue marker)")
      .action(async () => {
        await orchestrator.stop(buildContext(config, project.name));
      });
    orchCmd
      .command("status")
      .description("report whether the orchestrator window is up")
      .action(async () => {
        await orchestrator.status(buildContext(config, project.name));
      });

    projectCmd
      .command("wt <feature> [repos...]")
      .description("spin up a feature environment. no repos = all (git worktrees + compose stacks + one claude agent). with repos = only those.")
      .action(async (feature: string, repos: string[]) => {
        await wtAll(
          config,
          project.name,
          feature,
          repos.length > 0 ? { only: repos } : {},
        );
      });

    projectCmd
      .command("wt-rm <feature> [repo]")
      .description("remove worktree (keep branch) and close pane. omit repo to act on all worktrees of this feature")
      .action(async (feature: string, repo: string | undefined) => {
        const repos = resolveRepos(getProject(config, project.name), feature, repo);
        for (const r of repos) {
          if (repos.length > 1) logger.info(`=== ${r} ===`);
          await wtRm(buildContext(config, project.name, { feature, repoName: r }));
        }
      });

    projectCmd
      .command("wt-ls")
      .description("list worktrees across all repos")
      .action(async () => {
        await wtLs(buildContext(config, project.name));
      });

    projectCmd
      .command("rebase <feature> [repo]")
      .description("fetch + rebase worktree on base branch. omit repo to rebase all worktrees of this feature")
      .option("-b, --base <branch>", "override base branch (default: repo baseBranch / origin/HEAD / main)")
      .action(async (feature: string, repo: string | undefined, opts: { base?: string }) => {
        const repos = resolveRepos(getProject(config, project.name), feature, repo);
        for (const r of repos) {
          if (repos.length > 1) logger.info(`=== ${r} ===`);
          await rebase(
            buildContext(config, project.name, { feature, repoName: r }),
            { base: opts.base },
          );
        }
      });

    projectCmd
      .command("merge <feature> [repo]")
      .description("push + create MR/PR + merge (GitLab/GitHub). --local to skip the MR flow.")
      .option("-b, --base <branch>", "override base branch (default: repo baseBranch / origin/HEAD / main)")
      .option("--local", "skip the MR/PR flow, merge locally as before")
      .option("--wait", "wait for CI to pass, then auto-merge")
      .option("--draft", "create MR as draft (don't attempt to merge)")
      .option("--open", "open the MR/PR in the browser after creating")
      .option(
        "--strategy <strategy>",
        "merge strategy: squash | merge | rebase (default: squash)",
        "squash",
      )
      .option(
        "--skip-preflight",
        "skip the local rebase / conflict preview before pushing",
      )
      .option(
        "--auto-resolve",
        "on conflict, launch the claude resolver without asking",
      )
      .action(
        async (
          feature: string,
          repo: string | undefined,
          opts: {
            base?: string;
            local?: boolean;
            wait?: boolean;
            draft?: boolean;
            open?: boolean;
            strategy?: "squash" | "merge" | "rebase";
            skipPreflight?: boolean;
            autoResolve?: boolean;
          },
        ) => {
          const repos = resolveRepos(getProject(config, project.name), feature, repo);
          for (const r of repos) {
            if (repos.length > 1) logger.info(`=== ${r} ===`);
            await merge(
              buildContext(config, project.name, { feature, repoName: r }),
              {
                base: opts.base,
                local: opts.local,
                wait: opts.wait,
                draft: opts.draft,
                open: opts.open,
                strategy: opts.strategy,
                skipPreflight: opts.skipPreflight,
                autoResolve: opts.autoResolve,
              },
            );
          }
        },
      );

    projectCmd
      .command("cleanup <feature> [repo]")
      .description("remove worktree + delete branch (safe) + close pane. omit repo to cleanup all worktrees of this feature")
      .action(async (feature: string, repo: string | undefined) => {
        const repos = resolveRepos(getProject(config, project.name), feature, repo);
        for (const r of repos) {
          if (repos.length > 1) logger.info(`=== ${r} ===`);
          await cleanup(buildContext(config, project.name, { feature, repoName: r }));
        }
      });

    // config mutation commands
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
      .command("test <feature> [repos...]")
      .description("launch run commands for a feature's worktrees (isolated ports)")
      .action(async (feature: string, repos: string[]) => {
        await testCmd(config, project.name, feature, repos.length > 0 ? repos : undefined);
      });

    projectCmd
      .command("test-stop <feature>")
      .description("stop test processes for a feature (kills the test window)")
      .action(async (feature: string) => {
        await testStop(buildContext(config, project.name), feature);
      });

    projectCmd
      .command("test-ls")
      .description("list currently running test features")
      .action(async () => {
        await testLs(buildContext(config, project.name));
      });

    projectCmd
      .command("deploy [repo] [args...]")
      .description("run the deployCommand for the project (or a specific repo). extra args pass through to the command")
      .allowUnknownOption()
      .action(async (repoName: string | undefined, args: string[]) => {
        const code = await deploy(config, project.name, repoName, args);
        if (code !== 0) process.exit(code);
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

    // ── env (compose) commands ────────────────────────────────────────────
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
      .command("logs <feature> [service]")
      .description("tail logs of a compose stack (optionally filtered to a single service)")
      .action(async (feature: string, service: string | undefined) => {
        await envLogs(config, project.name, feature, service);
      });

    envCmd
      .command("exec <feature> <service> [command...]")
      .description("exec into a service (defaults to sh)")
      .action(async (feature: string, service: string, command: string[]) => {
        await envExec(config, project.name, feature, service, command);
      });

    envCmd
      .command("recreate <feature>")
      .description("down -v + up (reset volumes for a fresh DB)")
      .action(async (feature: string) => {
        await envRecreate(config, project.name, feature);
      });

    envCmd
      .command("up <feature>")
      .description("start compose stacks for a feature without touching git worktrees")
      .action(async (feature: string) => {
        await envUp(config, project.name, feature);
      });

    envCmd
      .command("down <feature>")
      .description("stop compose stacks for a feature (volumes kept)")
      .action(async (feature: string) => {
        await envDown(config, project.name, feature);
      });
  }

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    if (err instanceof BanyanError) {
      logger.error(err.message);
      return 1;
    }
    // commander's CommanderError has `.code`, `.exitCode`
    const anyErr = err as { code?: string; exitCode?: number; message?: string };
    if (anyErr.code === "commander.helpDisplayed" || anyErr.code === "commander.help" || anyErr.code === "commander.version") {
      return 0;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error(message);
    return 1;
  }
}

export function knownProjectNames(config: Config): string[] {
  return config.projects.map((p) => p.name);
}
