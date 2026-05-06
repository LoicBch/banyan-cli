/**
 * Autopilot driver for banyan agents.
 *
 * Implements the loop mechanism for `mode: autopilot` by leveraging Claude
 * Code's `Stop` hook system — each time the agent finishes a turn, the hook
 * fires; we decide whether the task is genuinely complete (TODO list all
 * done AND a report has been submitted), and if not we tell claude to keep
 * going.
 *
 * Mechanism:
 *   1. At `bn wt --mode autopilot` time, we materialize a per-feature
 *      settings.json file with a Stop hook registered. We then pass that
 *      file to `claude --settings <path>`.
 *   2. The hook command is `bn _autopilot-tick <project> <feature>`. Claude
 *      runs it after every Stop event.
 *   3. The tick reads the TODO list and the reports timeline. If both
 *      conditions for "task done" are met, it exits 0 (allow claude to
 *      stop). Otherwise it emits `{"decision": "block", "reason": "..."}`
 *      and claude resumes the conversation with that reason as a new
 *      directive.
 *
 * This is claude-specific by design — until banyan goes model-agnostic
 * (own future cycle), this is the simplest path that gives us a robust
 * loop without leaving the interactive tmux UX.
 */
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getTodo, isTodoComplete } from "./todo.js";
import { readReports } from "./reports.js";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");

export function autopilotSettingsPath(project: string, feature: string): string {
  return path.join(STATE_DIR, `${project}.${feature}.autopilot-settings.json`);
}

/** Resolve the absolute path to the running banyan binary so the hook can
 *  invoke it without depending on the user's PATH inside claude's hook
 *  shell environment. */
function banyanBinPath(): string {
  // process.argv[1] points at the actual entrypoint script that was invoked
  // (dist/src/bin/banyan.js after build, or whatever the user linked).
  const fromArgv = process.argv[1];
  if (fromArgv && existsSync(fromArgv)) return fromArgv;
  // Fallback: assume `banyan` is on PATH.
  return "banyan";
}

/** Materialize a settings.json file for `claude --settings` that registers
 *  the autopilot Stop hook for this (project, feature). Returns the path. */
export function generateAutopilotSettings(
  project: string,
  feature: string,
): string {
  const settingsPath = autopilotSettingsPath(project, feature);
  const bn = banyanBinPath();
  // Quote the bn path defensively in case it contains spaces.
  const command = `${JSON.stringify(bn)} _autopilot-tick ${shellEscape(project)} ${shellEscape(feature)}`;
  const settings = {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command,
            },
          ],
        },
      ],
    },
  };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  return settingsPath;
}

export function removeAutopilotSettings(project: string, feature: string): void {
  const p = autopilotSettingsPath(project, feature);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

/** Lightweight shell escape for path/identifier args. We don't need full
 *  POSIX escaping here — project/feature names have already been validated
 *  to exclude '/', and we only need to handle whitespace and quoting. */
function shellEscape(s: string): string {
  if (/^[A-Za-z0-9._-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Decide whether the agent's task is genuinely complete.
 *
 *  Conditions for "complete" (both must hold):
 *   - the TODO list exists and every item is marked done
 *   - at least one `banyan_report_done` has been submitted for this feature
 *
 *  If the list is missing entirely we don't block — the agent might be in
 *  autopilot but legitimately unable to scope a TODO yet (e.g. needs to
 *  read code first). But we DO require a report at the end regardless. */
export function isAutopilotComplete(project: string, feature: string): {
  complete: boolean;
  reason: string;
} {
  const reports = readReports(project, { feature });
  if (reports.length === 0) {
    return {
      complete: false,
      reason: `No banyan_report_done has been submitted for feature '${feature}'. Don't stop the session yet — finish the work then call banyan_report_done.`,
    };
  }

  const todo = getTodo(project, feature);
  if (todo && todo.items.length > 0 && !isTodoComplete(todo)) {
    const remaining = todo.items.filter((it) => !it.done);
    const remainingList = remaining
      .map((it) => `  - [${it.id}] ${it.text}`)
      .join("\n");
    return {
      complete: false,
      reason: `Your TODO list still has ${remaining.length} unfinished item${remaining.length > 1 ? "s" : ""}:\n${remainingList}\nKeep working through them. Mark each done with banyan_update_todo as you complete it.`,
    };
  }

  return { complete: true, reason: "" };
}

/** Run a single autopilot tick. Reads stdin (claude's hook input) for
 *  protocol compliance, then writes either:
 *   - nothing + exit 0  → claude stops normally
 *   - `{"decision": "block", "reason": "..."}` to stdout → claude resumes */
export async function autopilotTick(project: string, feature: string): Promise<number> {
  // Drain stdin (we don't use it for now, but Stop hooks always receive a
  // JSON payload from claude — leaving it unread can cause EPIPE on its
  // side in some environments).
  await drainStdin();

  const { complete, reason } = isAutopilotComplete(project, feature);
  if (complete) {
    // exit 0, no output → claude stops as it intended
    return 0;
  }
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  return 0;
}

function drainStdin(): Promise<void> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve();
    let timeout: NodeJS.Timeout;
    const finish = () => { clearTimeout(timeout); resolve(); };
    process.stdin.on("data", () => { /* discard */ });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    // Safety: don't hang forever if no stdin ever arrives.
    timeout = setTimeout(finish, 500);
  });
}

