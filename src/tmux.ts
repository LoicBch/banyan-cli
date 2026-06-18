import { run, runInherit, runOrThrow } from "./exec.js";
import { TmuxError } from "./errors.js";

/**
 * tmux resolves session/window names with prefix matching by default —
 * so `has-session -t p4n` happily matches a manually-created `p4n-dashboard`
 * session, then every subsequent banyan command starts polluting it.
 * Prefixing a target with `=` forces exact match (see tmux(1) "TARGETS").
 * Every banyan caller goes through these helpers so no call site forgets.
 */
const sess = (name: string): string => `=${name}`;
const win = (session: string, windowName: string): string => `=${session}:${windowName}`;
const winIndex = (session: string, index: number): string => `=${session}:${index}`;

export async function hasSession(name: string): Promise<boolean> {
  const r = await run("tmux", ["has-session", "-t", sess(name)]);
  return r.code === 0;
}

export async function newSession(
  name: string,
  windowName: string,
  cwd: string,
): Promise<string> {
  const out = await runOrThrow("tmux", [
    "new-session",
    "-d",
    "-s",
    name,
    "-n",
    windowName,
    "-c",
    cwd,
    "-P",
    "-F",
    "#{pane_id}",
  ]);
  return out.trim();
}

export async function killSession(name: string): Promise<void> {
  const r = await run("tmux", ["kill-session", "-t", sess(name)]);
  if (r.code !== 0 && !/can't find session/i.test(r.stderr)) {
    throw new TmuxError(`kill-session failed: ${r.stderr.trim()}`);
  }
}

export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

export async function attach(session: string): Promise<number> {
  if (isInsideTmux()) {
    return runInherit("tmux", ["switch-client", "-t", sess(session)]);
  }
  return runInherit("tmux", ["attach-session", "-t", sess(session)]);
}

export async function detachClients(session: string): Promise<void> {
  const r = await run("tmux", ["detach-client", "-s", session]);
  if (r.code !== 0 && !/can't find session/i.test(r.stderr)) {
    throw new TmuxError(`detach-client failed: ${r.stderr.trim()}`);
  }
}

export async function newWindow(
  session: string,
  windowName: string,
  cwd: string,
): Promise<string> {
  const out = await runOrThrow("tmux", [
    "new-window",
    "-t",
    sess(session),
    "-n",
    windowName,
    "-c",
    cwd,
    "-P",
    "-F",
    "#{pane_id}",
  ]);
  return out.trim();
}

/**
 * Insert a new window BEFORE the given index (`-b -t session:index`). Used
 * to place the canonical first window (e.g. `workspace`) at position 1 even
 * when other windows already exist (e.g. during `bn resume`).
 */
export async function newWindowBefore(
  session: string,
  windowName: string,
  cwd: string,
  beforeIndex: number,
): Promise<string> {
  const out = await runOrThrow("tmux", [
    "new-window",
    "-b",
    "-t",
    winIndex(session, beforeIndex),
    "-n",
    windowName,
    "-c",
    cwd,
    "-P",
    "-F",
    "#{pane_id}",
  ]);
  return out.trim();
}

export async function killWindow(session: string, windowName: string): Promise<void> {
  const r = await run("tmux", ["kill-window", "-t", win(session, windowName)]);
  if (r.code !== 0 && !/can't find/i.test(r.stderr)) {
    // window didn't exist — fine
  }
}

export async function selectWindow(session: string, windowName: string): Promise<void> {
  await run("tmux", ["select-window", "-t", win(session, windowName)]);
}

export async function windowExists(session: string, windowName: string): Promise<boolean> {
  const r = await run("tmux", [
    "list-windows",
    "-t",
    session,
    "-F",
    "#{window_name}",
  ]);
  if (r.code !== 0) return false;
  return r.stdout.split("\n").some((w) => w === windowName);
}

export async function splitWindow(
  session: string,
  windowName: string,
  cwd: string,
  opts: { size?: number; before?: boolean; horizontal?: boolean } = {},
): Promise<string> {
  const args = [
    "split-window",
    "-t",
    win(session, windowName),
    "-c",
    cwd,
  ];
  if (opts.horizontal) args.push("-h");
  if (opts.before) args.push("-b");
  if (opts.size !== undefined) {
    args.push("-l", `${opts.size}%`);
  }
  args.push("-P", "-F", "#{pane_id}");
  const out = await runOrThrow("tmux", args);
  return out.trim();
}

export async function selectPane(paneId: string): Promise<void> {
  const r = await run("tmux", ["select-pane", "-t", paneId]);
  if (r.code !== 0) {
    throw new TmuxError(`select-pane failed: ${r.stderr.trim()}`);
  }
}

export async function setPaneTitle(paneId: string, title: string): Promise<void> {
  const r = await run("tmux", ["select-pane", "-t", paneId, "-T", title]);
  if (r.code !== 0) {
    throw new TmuxError(`set pane title failed: ${r.stderr.trim()}`);
  }
}

export async function setPaneUserOption(
  paneId: string,
  key: string,
  value: string,
): Promise<void> {
  const r = await run("tmux", ["set-option", "-p", "-t", paneId, key, value]);
  if (r.code !== 0) {
    throw new TmuxError(`set-option -p failed: ${r.stderr.trim()}`);
  }
}

export async function applyLayout(
  session: string,
  windowName: string,
  layout: string,
): Promise<void> {
  const r = await run("tmux", [
    "select-layout",
    "-t",
    win(session, windowName),
    layout,
  ]);
  if (r.code !== 0 && !/no current window/i.test(r.stderr)) {
    // ignore errors when the window no longer exists
  }
}

/** Pane count inside a window. Returns 0 if the window doesn't exist. */
export async function paneCount(session: string, windowName: string): Promise<number> {
  const r = await run("tmux", [
    "display-message",
    "-p",
    "-t",
    win(session, windowName),
    "#{window_panes}",
  ]);
  if (r.code !== 0) return 0;
  const n = parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Enable pane border header for a window so each pane visibly shows its banyan tag
 * (or falls back to its pane_title).
 */
export async function enablePaneBorderLabels(
  session: string,
  windowName: string,
): Promise<void> {
  await run("tmux", [
    "set-option",
    "-w",
    "-t",
    win(session, windowName),
    "pane-border-status",
    "top",
  ]);
  await run("tmux", [
    "set-option",
    "-w",
    "-t",
    win(session, windowName),
    "pane-border-format",
    " #{?@banyan-pane,#{@banyan-pane},#{pane_title}} ",
  ]);
}

export async function findPaneByTitle(
  session: string,
  windowName: string,
  title: string,
): Promise<string | undefined> {
  const r = await run("tmux", [
    "list-panes",
    "-t",
    win(session, windowName),
    "-F",
    "#{pane_id}\t#{pane_title}",
  ]);
  if (r.code !== 0) return undefined;
  for (const line of r.stdout.split("\n")) {
    const [id, paneTitle] = line.split("\t");
    if (paneTitle === title && id) return id;
  }
  return undefined;
}

export async function findPaneByUserOption(
  session: string,
  windowName: string,
  key: string,
  value: string,
): Promise<string | undefined> {
  const r = await run("tmux", [
    "list-panes",
    "-t",
    win(session, windowName),
    "-F",
    `#{pane_id}\t#{${key}}`,
  ]);
  if (r.code !== 0) return undefined;
  for (const line of r.stdout.split("\n")) {
    const [id, optValue] = line.split("\t");
    if (optValue === value && id) return id;
  }
  return undefined;
}

export async function killPane(paneId: string): Promise<void> {
  const r = await run("tmux", ["kill-pane", "-t", paneId]);
  if (r.code !== 0 && !/can't find/i.test(r.stderr)) {
    throw new TmuxError(`kill-pane failed: ${r.stderr.trim()}`);
  }
}

/**
 * Kill whatever process is running in the pane and start a fresh shell at
 * `cwd`. The pane id is preserved, so geometry, title, and user options stay
 * intact. Useful for restarting a long-running TUI (e.g. Claude) in place
 * without recreating the pane.
 */
export async function respawnPane(paneId: string, cwd: string): Promise<void> {
  const r = await run("tmux", ["respawn-pane", "-k", "-t", paneId, "-c", cwd]);
  if (r.code !== 0) {
    throw new TmuxError(`respawn-pane failed: ${r.stderr.trim()}`);
  }
}

export async function sendKeys(
  paneId: string,
  keys: string,
  opts: { enter?: boolean } = {},
): Promise<void> {
  const args = ["send-keys", "-t", paneId, keys];
  if (opts.enter) args.push("Enter");
  const r = await run("tmux", args);
  if (r.code !== 0) {
    throw new TmuxError(`send-keys failed: ${r.stderr.trim()}`);
  }
}

/**
 * Return the current foreground command of a pane (e.g. "node", "zsh", "vim").
 * `node` is what Claude Code shows up as — any shell name means no agent is
 * attached and a `send-keys`/paste would be interpreted as shell commands.
 */
export async function paneCurrentCommand(paneId: string): Promise<string> {
  const r = await run("tmux", [
    "display-message",
    "-p",
    "-t",
    paneId,
    "#{pane_current_command}",
  ]);
  if (r.code !== 0) {
    throw new TmuxError(`display-message failed: ${r.stderr.trim()}`);
  }
  return r.stdout.trim();
}

/** Heuristic: is a Claude Code agent running in the pane (vs a bare shell)? */
export async function isClaudeRunning(paneId: string): Promise<boolean> {
  const cmd = await paneCurrentCommand(paneId);
  // Claude Code's Node.js binary may show up as "node", "claude" (if linked),
  // or the full path ending in one of these. Conservative: anything that is
  // NOT a known shell counts as "not shell".
  const SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "tcsh", "ksh"]);
  return !SHELLS.has(cmd.toLowerCase());
}

/**
 * Capture the last `nLines` visible in a tmux pane.
 * Useful for diagnostics (e.g. show the user what Claude is doing / not doing).
 */
export async function capturePane(paneId: string, nLines = 30): Promise<string> {
  const r = await run("tmux", [
    "capture-pane",
    "-t",
    paneId,
    "-p",
    "-S",
    `-${nLines}`,
  ]);
  if (r.code !== 0) {
    throw new TmuxError(`capture-pane failed: ${r.stderr.trim()}`);
  }
  return r.stdout;
}

/**
 * Paste a (possibly multi-line) text into a tmux pane via the buffer mechanism.
 * This is the reliable way to deliver large or multi-line text to TUI apps
 * (like Claude Code) whose input handling is fragile with bulk `send-keys`.
 *
 * Steps:
 *   1. Load text into a named tmux buffer via stdin.
 *   2. Paste the buffer into the pane (no literal Enter yet).
 *   3. If `opts.submit`, send Enter afterwards to submit.
 *   4. Delete the buffer to keep the buffer stack clean.
 */
export async function pasteText(
  paneId: string,
  text: string,
  opts: { submit?: boolean } = {},
): Promise<void> {
  const bufferName = `banyan-${process.pid}-${Date.now()}`;
  // 1. load-buffer from stdin
  const load = await run(
    "tmux",
    ["load-buffer", "-b", bufferName, "-"],
    { stdin: text },
  );
  if (load.code !== 0) {
    throw new TmuxError(`load-buffer failed: ${load.stderr.trim()}`);
  }
  // 2. paste-buffer
  const paste = await run("tmux", [
    "paste-buffer",
    "-b",
    bufferName,
    "-t",
    paneId,
    "-d", // delete buffer after pasting
  ]);
  if (paste.code !== 0) {
    // ensure cleanup on error
    await run("tmux", ["delete-buffer", "-b", bufferName]);
    throw new TmuxError(`paste-buffer failed: ${paste.stderr.trim()}`);
  }
  // 3. submit — give the TUI a moment to finish bracketed-paste processing
  //    before the Enter arrives; otherwise the Enter is consumed as part of
  //    the paste and the prompt stays in the input buffer unsubmitted.
  if (opts.submit) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const enter = await run("tmux", ["send-keys", "-t", paneId, "Enter"]);
    if (enter.code !== 0) {
      throw new TmuxError(`send Enter failed: ${enter.stderr.trim()}`);
    }
  }
}

export interface WindowInfo {
  name: string;
  active: boolean;
}

/**
 * List all `@banyan-pane` tags across all panes of a session (across all
 * windows). Used by the dashboard to correlate worktrees to live agent panes.
 */
export async function listBanyanPaneTags(session: string): Promise<string[]> {
  const r = await run("tmux", [
    "list-panes",
    "-s",
    "-t",
    sess(session),
    "-F",
    "#{@banyan-pane}",
  ]);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export async function listWindows(session: string): Promise<WindowInfo[]> {
  const r = await run("tmux", [
    "list-windows",
    "-t",
    sess(session),
    "-F",
    "#{window_name}\t#{window_active}",
  ]);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => {
      const [name, active] = l.split("\t");
      return { name: name ?? "", active: active === "1" };
    });
}
