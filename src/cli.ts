import { Command } from "commander";
import { loadConfig, type Config } from "./config.js";
import { BanyanError } from "./errors.js";
import { logger } from "./logger.js";
import { inferProjectFromCwd } from "./projectInference.js";
import { printBanner } from "./banner.js";
import { packageVersion } from "./version.js";

import { list } from "./commands/list.js";
import { init } from "./commands/init.js";
import { sidebar } from "./commands/sidebar.js";
import { whereami } from "./commands/whereami.js";
import { serve } from "./commands/serve.js";
import { installTmux } from "./commands/installTmux.js";
import { autopilotTick } from "./autopilot.js";

import { registerProjectCommands } from "./cli/project.js";

export async function run(argv: string[]): Promise<number> {
  // No-args banner: greet the user with the banyan splash before deferring
  // to commander's help. Skipped when stdout is piped (don't pollute scripts).
  if (argv.length === 0 && process.stdout.isTTY) {
    printBanner();
  }

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

  // Project inference from cwd:
  //   `bn wt menu-clean` → if cwd is inside a configured project's repo or
  //   worktree, prepend the project name so it behaves like
  //   `bn <inferred> wt menu-clean`. Triggered only when argv[0] is neither
  //   a known top-level command nor an explicit project name.
  const TOP_LEVEL_COMMANDS = new Set([
    "ls",
    "sidebar",
    "whereami",
    "init",
    "serve",
    "install-tmux",
    "_autopilot-tick",
    "mcp-serve",
    "mcp-log",
    "help",
    "--help",
    "-h",
    "--version",
    "-V",
  ]);
  const projectNames = new Set(config.projects.map((p) => p.name));
  if (
    argv.length > 0 &&
    !TOP_LEVEL_COMMANDS.has(argv[0]!) &&
    !projectNames.has(argv[0]!)
  ) {
    const inferred = inferProjectFromCwd(config, process.cwd());
    if (inferred) {
      argv = [inferred, ...argv];
    }
  }

  const program = new Command();
  program
    .name("banyan")
    .description("tmux + git worktrees + Claude Code, multi-repo per project")
    .version(packageVersion())
    .exitOverride();

  // ── top-level commands (no project) ──────────────────────────────────────
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
    .description(
      "create a new project (cwd as first repo by default) and immediately launch the workspace " +
        "(orchestrator + terminal pane). use --no-start to skip the launch — useful when you want " +
        "to add more repos with `bn <project> add-repo` before starting.",
    )
    .option("-r, --repo-name <name>", "name for the first repo (default: basename of cwd)")
    .option("-p, --path <path>", "path of the first repo (default: cwd)")
    .option("-l, --layout <path>", "layout script path (optional)")
    .option("--no-start", "register the project without launching the workspace")
    .action(
      async (
        project: string,
        opts: { repoName?: string; path?: string; layout?: string; start?: boolean },
      ) => {
        await init(config, project, opts);
      },
    );

  program
    .command("install-tmux")
    .description("render the banyan tmux config to ~/.config/banyan/banyan.tmux.conf")
    .option("-f, --force", "overwrite an existing rendered config")
    .action(async (opts: { force?: boolean }) => {
      await installTmux({ force: opts.force });
    });

  // Hidden internal command — invoked by claude as a Stop hook for features
  // launched in autopilot mode. Reads stdin (claude hook payload), checks
  // TODO + reports state, and either exits 0 (allow stop) or emits a block
  // directive to keep the agent looping.
  program
    .command("_autopilot-tick <project> <feature>")
    .description("[internal] Stop hook for autopilot mode")
    .action(async (proj: string, feat: string) => {
      const code = await autopilotTick(proj, feat);
      process.exit(code);
    });

  program
    .command("mcp-serve")
    .description("run the banyan MCP server over stdio (used by claude --mcp-config)")
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

  // ── per-project commands (delegated) ─────────────────────────────────────
  registerProjectCommands(program, config);

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
