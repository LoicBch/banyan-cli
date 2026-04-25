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
  debug(msg: string): void {
    if (debugEnabled) {
      process.stderr.write(`${color(90, "debug")} ${msg}\n`);
    }
  },
};

export type Logger = typeof logger;
