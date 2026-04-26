/**
 * `bn mcp-log` — show recent banyan MCP tool calls (made by the orchestrator
 * or any other MCP client connected to `banyan mcp-serve`).
 *
 * Each line in MCP_LOG_PATH is a JSON object with timestamp, tool name,
 * args, status, duration. We render them as one human-friendly line.
 *
 * `--follow` (`-f`) tails the file like `tail -f`.
 * `-n <N>` shows the last N entries (default: 50).
 */

import { existsSync, readFileSync, watchFile } from "node:fs";
import { MCP_LOG_PATH } from "../mcp/server.js";
import { logger } from "../logger.js";

interface ToolCallEntry {
  ts: string;
  pid: number;
  tool: string;
  args: unknown;
  status: "ok" | "error";
  durationMs: number;
  errorMsg?: string;
}

function color(code: number, s: string): string {
  return process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      let s: string;
      if (typeof v === "string") s = v;
      else if (Array.isArray(v)) s = `[${v.join(",")}]`;
      else s = JSON.stringify(v);
      return `${k}=${s}`;
    })
    .join(" ");
}

function formatEntry(e: ToolCallEntry): string {
  const time = e.ts.replace(/^\d{4}-\d{2}-\d{2}T/, "").replace(/\.\d+Z$/, "");
  const status =
    e.status === "ok" ? color(32, "✓") : color(31, "✗");
  const tool = color(36, e.tool);
  const dur = color(90, `${e.durationMs}ms`);
  const argsSummary = summarizeArgs(e.args);
  const argsPart = argsSummary ? ` ${color(90, argsSummary)}` : "";
  const errPart =
    e.status === "error" && e.errorMsg ? ` ${color(31, "—")} ${e.errorMsg}` : "";
  return `${color(90, time)} ${status} ${tool}${argsPart} ${dur}${errPart}`;
}

function readEntries(): ToolCallEntry[] {
  if (!existsSync(MCP_LOG_PATH)) return [];
  const raw = readFileSync(MCP_LOG_PATH, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      try {
        return JSON.parse(l) as ToolCallEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is ToolCallEntry => e !== null);
}

export async function mcpLog(opts: { follow?: boolean; n?: number }): Promise<void> {
  const all = readEntries();
  const tail = opts.n ?? 50;
  const slice = all.slice(-tail);

  if (slice.length === 0) {
    logger.info(`(no MCP calls logged yet — log file: ${MCP_LOG_PATH})`);
  } else {
    for (const e of slice) {
      logger.info(formatEntry(e));
    }
  }

  if (!opts.follow) return;

  // Tail mode: watch file and print new entries as they appear.
  let lastSize = existsSync(MCP_LOG_PATH)
    ? readFileSync(MCP_LOG_PATH, "utf8").length
    : 0;

  logger.info(color(90, `--- following ${MCP_LOG_PATH} (Ctrl+C to stop) ---`));

  watchFile(MCP_LOG_PATH, { interval: 500 }, () => {
    if (!existsSync(MCP_LOG_PATH)) return;
    const raw = readFileSync(MCP_LOG_PATH, "utf8");
    if (raw.length <= lastSize) {
      lastSize = raw.length;
      return;
    }
    const newPart = raw.slice(lastSize);
    lastSize = raw.length;
    for (const line of newPart.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as ToolCallEntry;
        logger.info(formatEntry(e));
      } catch {
        // skip malformed
      }
    }
  });

  // Keep process alive until SIGINT
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}
