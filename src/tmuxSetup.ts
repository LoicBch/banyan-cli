/**
 * Tmux config bootstrap. Renders `tmux/banyan.conf` (with `__BANYAN_TMUX_DIR__`
 * replaced by the live install path) to `~/.config/banyan/banyan.tmux.conf`,
 * and helps the user wire it into their `~/.tmux.conf`.
 *
 * Two entry points:
 *   - setupTmuxOnInit()        — called from `bn init`. Renders, then if the
 *                                source-file line is missing from ~/.tmux.conf,
 *                                prompts the user to append it.
 *   - refreshTmuxConfSilently() — called from `bn <project> start`. Re-renders
 *                                if stale (e.g. after a banyan upgrade with a
 *                                new template). No prompting.
 */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { logger } from "./logger.js";
import { UsageError } from "./errors.js";

const PLACEHOLDER = "__BANYAN_TMUX_DIR__";

function findTmuxScriptsDir(): string {
  // This file lives at <install>/dist/src/tmuxSetup.js after build.
  // The tmux scripts are shipped at <install>/dist/tmux/*.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../tmux"),    // dist/src → dist/tmux
    path.resolve(here, "../../tmux"), // dev: src → repo/tmux
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "banyan.conf"))) return c;
  }
  throw new UsageError(
    "could not locate banyan tmux scripts directory (looked next to the install)",
  );
}

export interface RenderResult {
  path: string;
  /** True if the on-disk file was created or its content changed. */
  written: boolean;
}

/** Idempotent render: no-op when the on-disk content already matches. */
export function renderTmuxConf(): RenderResult {
  const scriptsDir = findTmuxScriptsDir();
  const template = readFileSync(path.join(scriptsDir, "banyan.conf"), "utf8");
  const rendered = template.replaceAll(PLACEHOLDER, scriptsDir);

  const outDir = path.join(homedir(), ".config", "banyan");
  const outPath = path.join(outDir, "banyan.tmux.conf");

  if (existsSync(outPath) && readFileSync(outPath, "utf8") === rendered) {
    return { path: outPath, written: false };
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, rendered, "utf8");
  return { path: outPath, written: true };
}

function tmuxConfPath(): string {
  return path.join(homedir(), ".tmux.conf");
}

function tmuxConfIncludesBanyan(renderedPath: string): boolean {
  const conf = tmuxConfPath();
  if (!existsSync(conf)) return false;
  return readFileSync(conf, "utf8").includes(renderedPath);
}

function appendSourceLine(renderedPath: string): void {
  const conf = tmuxConfPath();
  const existing = existsSync(conf) ? readFileSync(conf, "utf8") : "";
  const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const block = `${sep}\n# banyan keybindings (Alt+M merge, Alt+C cleanup, …)\nsource-file ${renderedPath}\n`;
  writeFileSync(conf, existing + block, "utf8");
}

function reloadTmuxIfRunning(): void {
  // Best-effort: tmux exits non-zero with no server, ignore.
  try {
    spawn("tmux", ["source-file", tmuxConfPath()], { stdio: "ignore" }).on(
      "error",
      () => {},
    );
  } catch {
    /* tmux not installed */
  }
}

async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/** Called from `bn init`. Renders the conf, then prompts to wire it. */
export async function setupTmuxOnInit(): Promise<void> {
  const { path: outPath, written } = renderTmuxConf();
  if (written) logger.ok(`rendered tmux keybindings → ${outPath}`);

  if (tmuxConfIncludesBanyan(outPath)) return;

  const line = `source-file ${outPath}`;

  if (!process.stdin.isTTY) {
    logger.info(``);
    logger.info(`add this line to your ~/.tmux.conf to enable Alt+M / Alt+C / Alt+R / Alt+T / Alt+D bindings:`);
    logger.info(`  ${line}`);
    return;
  }

  const ok = await promptYesNo(
    `enable banyan tmux shortcuts (Alt+M merge, Alt+C cleanup, …) by appending \`${line}\` to ~/.tmux.conf?`,
  );
  if (ok) {
    appendSourceLine(outPath);
    reloadTmuxIfRunning();
    logger.ok(`appended source-file line to ~/.tmux.conf`);
  } else {
    logger.info(`skipped. add manually anytime: ${line}`);
  }
}

/** Called from `bn <project> start`. Silent re-render, prints only when the
 *  file actually changed (e.g. after a banyan upgrade). Never throws — tmux
 *  setup shouldn't block a workspace launch. */
export function refreshTmuxConfSilently(): void {
  try {
    const { written, path: outPath } = renderTmuxConf();
    if (written) logger.info(`refreshed tmux keybindings → ${outPath}`);
  } catch {
    /* swallow */
  }
}
