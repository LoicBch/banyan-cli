#!/usr/bin/env node
import path from "node:path";
import { run } from "../cli.js";
import { loadConfig, resolveCurrentProject, type Config } from "../config.js";
import { logger } from "../logger.js";
import { BanyanError } from "../errors.js";

const RESERVED = new Set(["banyan", "bn", "banyan.js", "bn.js"]);
const TOPLEVEL_CMDS = new Set([
  "ls",
  "init",
  "serve",
  "install-tmux",
  "_autopilot-tick",
  "help",
  "-h",
  "--help",
  "-V",
  "--version",
]);

async function main(): Promise<void> {
  const invokedPath = process.argv[1] ?? "";
  const invoked = path.basename(invokedPath);
  const rest = process.argv.slice(2);

  let argv = rest;

  let cfg: Config | undefined;
  try {
    cfg = await loadConfig();
  } catch {
    // no config yet — let cli handle (init / ls still work, others will error)
  }

  if (cfg) {
    // 1. busybox: binary invoked via symlink named after a project
    if (!RESERVED.has(invoked) && cfg.projects.some((p) => p.name === invoked)) {
      argv = [invoked, ...rest];
    } else {
      // 2. context-aware: first arg neither a project nor a top-level command
      //    → try to detect project from cwd
      const firstArg = rest[0];
      if (
        firstArg &&
        !cfg.projects.some((p) => p.name === firstArg) &&
        !TOPLEVEL_CMDS.has(firstArg)
      ) {
        const current = resolveCurrentProject(cfg, process.cwd());
        if (current) argv = [current.name, ...rest];
      }
    }
  }

  const code = await run(argv);
  process.exit(code);
}

main().catch((err) => {
  if (err instanceof BanyanError) {
    if (err.details) {
      logger.fail(err.details.title ?? err.message, {
        ...(err.details.cause ? { cause: err.details.cause } : { cause: err.message }),
        ...(err.details.fix ? { fix: err.details.fix } : {}),
      });
    } else {
      logger.error(err.message);
    }
  } else {
    logger.fail("unexpected error", { cause: err instanceof Error ? err.message : String(err) });
  }
  process.exit(1);
});
