import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";
import { UsageError } from "../errors.js";

export interface InstallTmuxOpts {
  force?: boolean;
}

const PLACEHOLDER = "__BANYAN_TMUX_DIR__";

function findTmuxScriptsDir(): string {
  // This file lives at <install>/dist/src/commands/installTmux.js after build.
  // The tmux scripts are shipped at <install>/dist/tmux/*.sh.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../tmux"),     // dist/src/commands → dist/tmux
    path.resolve(here, "../../../tmux"),  // dev: src/commands → repo/tmux
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "banyan.conf"))) return c;
  }
  throw new UsageError(
    "could not locate banyan tmux scripts directory (looked next to the install)",
  );
}

export async function installTmux(opts: InstallTmuxOpts = {}): Promise<void> {
  const scriptsDir = findTmuxScriptsDir();
  const templatePath = path.join(scriptsDir, "banyan.conf");
  const template = readFileSync(templatePath, "utf8");
  const rendered = template.replaceAll(PLACEHOLDER, scriptsDir);

  const outDir = path.join(homedir(), ".config", "banyan");
  const outPath = path.join(outDir, "banyan.tmux.conf");
  if (existsSync(outPath) && !opts.force) {
    logger.warn(`${outPath} already exists — pass --force to overwrite`);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, rendered, "utf8");

  logger.ok(`wrote ${outPath}`);
  logger.info(``);
  logger.info(`Add this line to your ~/.tmux.conf:`);
  logger.info(``);
  logger.info(`  source-file ${outPath}`);
  logger.info(``);
  logger.info(`Then reload tmux: tmux source-file ~/.tmux.conf`);
}
