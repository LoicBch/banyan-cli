import { Command } from "commander";
import { loadConfig, type Config } from "./config.js";
import { BanyanError } from "./errors.js";
import { logger } from "./logger.js";
import { inferProjectFromCwd } from "./projectInference.js";
import { printBanner } from "./banner.js";
import { packageVersion } from "./version.js";

import { list } from "./commands/list.js";
import { init } from "./commands/init.js";
import { serve } from "./commands/serve.js";
import { doctor } from "./commands/doctor.js";
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
      // allow `init`, `ls`, and `doctor` even if config doesn't exist yet
      // (doctor in particular needs to run before any config exists, that's
      // its whole point).
      if (argv[0] === "init" || argv[0] === "ls" || argv[0] === "doctor") {
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
    "init",
    "serve",
    "doctor",
    "_autopilot-tick",
    "mcp-serve",
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
    .command("serve")
    .description("start the web dashboard. add --remote to expose it via a public HTTPS tunnel (Cloudflare/ngrok) with token auth and a QR code for phone access.")
    .option("-p, --port <number>", "port to bind (default: first free from 4242)", (v) => parseInt(v, 10))
    .option("--no-open", "don't open the browser automatically")
    .option(
      "--remote",
      "expose the dashboard publicly via a tunnel; requires cloudflared or ngrok installed. enables token auth and prints a QR code.",
    )
    .option(
      "--tunnel <provider>",
      "force a tunnel provider: cloudflared | ngrok (default: auto-detect, prefer cloudflared)",
    )
    .option("--rotate-token", "rotate the auth token before starting (invalidates previous QRs)")
    .action(async (opts: { port?: number; open?: boolean; remote?: boolean; tunnel?: string; rotateToken?: boolean }) => {
      const tunnel =
        opts.tunnel === "cloudflared" || opts.tunnel === "ngrok"
          ? opts.tunnel
          : undefined;
      await serve(config, {
        port: opts.port,
        open: opts.open,
        ...(opts.remote ? { remote: true } : {}),
        ...(tunnel ? { tunnel } : {}),
        ...(opts.rotateToken ? { rotateToken: true } : {}),
      });
    });

  program
    .command("doctor")
    .description(
      "check that the environment is ready for banyan: tmux, git, claude CLI, optional gh/glab, and your banyan config. " +
        "exits 0 if everything required is present (warnings are non-blocking), 1 if anything is missing.",
    )
    .action(async () => {
      const code = await doctor(config);
      process.exit(code);
    });

  program
    .command("init <project>")
    .description(
      "register a new project in the banyan config (cwd as the first repo by default). " +
        "this command only writes config; run `bn <project> start` afterwards to launch the workspace " +
        "(orchestrator + terminal). multi-repo: register additional repos with `bn <project> add-repo` " +
        "before starting.",
    )
    .option("-r, --repo-name <name>", "name for the first repo (default: basename of cwd)")
    .option("-p, --path <path>", "path of the first repo (default: cwd)")
    .action(
      async (
        project: string,
        opts: { repoName?: string; path?: string },
      ) => {
        await init(config, project, opts);
      },
    );

  // Hidden internal command — invoked by claude as a Stop hook for features
  // launched in autopilot mode. Reads stdin (claude hook payload), checks
  // TODO + reports state, and either exits 0 (allow stop) or emits a block
  // directive to keep the agent looping.
  program
    .command("_autopilot-tick <project> <feature>", { hidden: true })
    .description("[internal] Stop hook for autopilot mode")
    .action(async (proj: string, feat: string) => {
      const code = await autopilotTick(proj, feat);
      process.exit(code);
    });

  program
    .command("mcp-serve", { hidden: true })
    .description("[internal] MCP server over stdio (invoked by claude via --mcp-config; never run by hand)")
    .action(async () => {
      const { runMcpServer } = await import("./mcp/server.js");
      await runMcpServer();
    });

  // ── per-project commands (delegated) ─────────────────────────────────────
  registerProjectCommands(program, config);

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    if (err instanceof BanyanError) {
      if (err.details) {
        logger.fail(err.details.title ?? err.message, {
          ...(err.details.cause ? { cause: err.details.cause } : { cause: err.message }),
          ...(err.details.fix ? { fix: err.details.fix } : {}),
        });
      } else {
        // No structured details — keep the legacy compact format so existing
        // error sites that just `throw new UsageError("…")` still look fine.
        logger.error(err.message);
      }
      return 1;
    }
    // commander's CommanderError has `.code`, `.exitCode`
    const anyErr = err as { code?: string; exitCode?: number; message?: string };
    if (anyErr.code === "commander.helpDisplayed" || anyErr.code === "commander.help" || anyErr.code === "commander.version") {
      return 0;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.fail("unexpected error", { cause: message });
    return 1;
  }
}

export function knownProjectNames(config: Config): string[] {
  return config.projects.map((p) => p.name);
}
