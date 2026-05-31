const isTTY = process.stdout.isTTY === true;
const debugEnabled = !!process.env.BANYAN_DEBUG;

function color(code: number, s: string): string {
  return isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
}

/**
 * When BANYAN_STDIO_QUIET=1 (set by the MCP stdio server), all logger output
 * is redirected to stderr so it can't corrupt the JSON-RPC stream on stdout.
 */
const stdioQuiet = !!process.env.BANYAN_STDIO_QUIET;

function out(msg: string): void {
  if (stdioQuiet) process.stderr.write(msg);
  else process.stdout.write(msg);
}

/** Bold red box drawn around a single line of text. Used by `logger.fail`
 *  so a terminal-end failure pops visually above the surrounding log noise. */
function failBanner(title: string): string {
  const red = (s: string) => color(91, s); // bright red
  const bold = (s: string) => (isTTY ? `\x1b[1m${s}\x1b[22m` : s);
  return `${red(bold("❌ FAILED"))}  ${red(bold(title))}`;
}

export const logger = {
  info(msg: string): void {
    out(`${msg}\n`);
  },
  ok(msg: string): void {
    out(`${color(32, "✓")} ${msg}\n`);
  },
  warn(msg: string): void {
    process.stderr.write(`${color(33, "!")} ${msg}\n`);
  },
  error(msg: string): void {
    process.stderr.write(`${color(31, "✗")} ${msg}\n`);
  },
  /**
   * Prominent terminal-failure message. Use when a command can't complete and
   * the user needs to know what to do next.
   *   logger.fail("merge aborted", {
   *     cause: "MR was already merged via a sibling branch",
   *     fix: ["bn <project> cleanup <feature> --force"],
   *   });
   * Renders:
   *   ❌ FAILED  merge aborted
   *     why: MR was already merged via a sibling branch
   *     fix: bn <project> cleanup <feature> --force
   */
  fail(title: string, opts: { cause?: string; fix?: string | string[] } = {}): void {
    const out = process.stderr;
    out.write(`\n${failBanner(title)}\n`);
    if (opts.cause) {
      const lines = opts.cause.split("\n");
      out.write(`  ${color(90, "why:")} ${lines[0]}\n`);
      for (const l of lines.slice(1)) out.write(`       ${l}\n`);
    }
    if (opts.fix) {
      const fixes = Array.isArray(opts.fix) ? opts.fix : [opts.fix];
      out.write(`  ${color(90, "fix:")} ${fixes[0]}\n`);
      for (const l of fixes.slice(1)) out.write(`       ${l}\n`);
    }
    out.write("\n");
  },
  debug(msg: string): void {
    if (debugEnabled) {
      process.stderr.write(`${color(90, "debug")} ${msg}\n`);
    }
  },
};

export type Logger = typeof logger;
