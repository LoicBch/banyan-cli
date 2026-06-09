/**
 * Cross-platform "open a native terminal window running this command".
 *
 * Lets the dashboard pop a real iTerm / Terminal.app / gnome-terminal /
 * wt.exe attached to the tmux session — so creating a feature from the
 * web UI lands you in front of the live agent without manual attach.
 *
 * Only used in local mode. The dashboard's `--remote` tunnel path won't
 * call this (it can't — the phone can't spawn windows on your laptop).
 *
 * Best-effort: we try the most common terminal apps in order. A failure
 * is non-fatal — the feature is already spawned, the terminal pop is
 * just convenience.
 */
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface LaunchOptions {
  /** Shell command to run in the new terminal window (e.g. `bn p4n start`). */
  command: string;
  /** Working directory the terminal opens in. Defaults to $HOME. */
  cwd?: string;
  /** Tmux session name. If set + the session already has an attached
   *  client, we skip opening a new window and just bring the terminal
   *  app to the front so the user can switch to the existing tmux pane. */
  existingTmuxSession?: string;
}

export interface LaunchResult {
  ok: boolean;
  terminal?: string;
  /** True when we detected an existing tmux client and just brought the
   *  terminal app to front instead of spawning a new window. */
  attachedToExisting?: boolean;
  error?: string;
}

/** Check whether tmux has at least one client attached to the given session.
 *  When true we don't want to spawn a second terminal window — the user
 *  already has one open with the session in it. */
async function sessionHasAttachedClient(session: string): Promise<boolean> {
  try {
    const { stdout } = await execFileP("tmux", ["list-clients", "-t", session], {
      encoding: "utf8",
    });
    return stdout.trim().length > 0;
  } catch {
    // tmux exits non-zero when the session doesn't exist or no server is
    // running — both mean "no client attached".
    return false;
  }
}

export async function openTerminalWindow(opts: LaunchOptions): Promise<LaunchResult> {
  // Short-circuit when an existing terminal is already attached to the tmux
  // session for this project. Saves the user from a redundant second window.
  if (opts.existingTmuxSession) {
    const attached = await sessionHasAttachedClient(opts.existingTmuxSession);
    if (attached) {
      const r = await bringTerminalToFront();
      return { ...r, attachedToExisting: true };
    }
  }
  switch (process.platform) {
    case "darwin":
      return openOnMac(opts);
    case "linux":
      return openOnLinux(opts);
    case "win32":
      return openOnWindows(opts);
    default:
      return { ok: false, error: `unsupported platform: ${process.platform}` };
  }
}

/** Activate the terminal app currently most likely to hold the tmux client,
 *  without opening a new window. Prefers iTerm if installed, else
 *  Terminal.app on macOS; no-op on other platforms (we'd need a window
 *  manager hook). */
async function bringTerminalToFront(): Promise<LaunchResult> {
  if (process.platform === "darwin") {
    const target = existsSync("/Applications/iTerm.app") ? "iTerm" : "Terminal";
    return runAppleScript(`tell application "${target}" to activate`, target);
  }
  // Linux / Windows: we can't reliably "find and raise" the right window
  // without a desktop env API hook. Return ok so the caller can show a
  // gentler toast instead of an error.
  return { ok: true, terminal: "existing" };
}

// ── macOS ────────────────────────────────────────────────────────────────

/** Prefer iTerm2 when installed (most banyan users have it); fall back to
 *  Terminal.app which ships with macOS. */
function openOnMac(opts: LaunchOptions): Promise<LaunchResult> {
  const iterm = existsSync("/Applications/iTerm.app");
  if (iterm) return runAppleScript(itermScript(opts), "iTerm");
  return runAppleScript(terminalScript(opts), "Terminal");
}

function itermScript(opts: LaunchOptions): string {
  const cdPart = opts.cwd ? `cd ${shellEscape(opts.cwd)} && ` : "";
  const cmd = shellEscape(`${cdPart}${opts.command}`);
  // Activate to bring iTerm forward, create a new window, write the command
  // into its default session.
  return `tell application "iTerm"
    activate
    create window with default profile
    tell current session of current window
      write text ${cmd}
    end tell
  end tell`;
}

function terminalScript(opts: LaunchOptions): string {
  const cdPart = opts.cwd ? `cd ${shellEscape(opts.cwd)} && ` : "";
  const cmd = shellEscape(`${cdPart}${opts.command}`);
  return `tell application "Terminal"
    activate
    do script ${cmd}
  end tell`;
}

function runAppleScript(script: string, terminal: string): Promise<LaunchResult> {
  return new Promise((resolve) => {
    const child = spawn("osascript", ["-e", script], {
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true, terminal });
      else resolve({ ok: false, error: stderr.trim() || `osascript exited ${code}` });
    });
    child.unref();
  });
}

// ── Linux ────────────────────────────────────────────────────────────────

/** Try the most common terminal emulators in order. `exec bash` at the end
 *  keeps the window open after the command exits — useful if `bn start`
 *  detaches or finishes quickly. */
function openOnLinux(opts: LaunchOptions): Promise<LaunchResult> {
  const cdPart = opts.cwd ? `cd ${shellEscape(opts.cwd)} && ` : "";
  const inner = `${cdPart}${opts.command}; exec bash`;
  const candidates: Array<{ name: string; args: string[] }> = [
    { name: "gnome-terminal", args: ["--", "bash", "-c", inner] },
    { name: "konsole", args: ["-e", "bash", "-c", inner] },
    { name: "alacritty", args: ["-e", "bash", "-c", inner] },
    { name: "kitty", args: ["bash", "-c", inner] },
    { name: "wezterm", args: ["start", "--", "bash", "-c", inner] },
    { name: "xterm", args: ["-e", "bash", "-c", inner] },
  ];
  return tryCandidates(candidates);
}

// ── Windows ──────────────────────────────────────────────────────────────

/** Windows Terminal is the modern default; fall back to cmd.exe in a new
 *  window via `start`. */
function openOnWindows(opts: LaunchOptions): Promise<LaunchResult> {
  const cwdArgs = opts.cwd ? ["-d", opts.cwd] : [];
  const candidates: Array<{ name: string; args: string[] }> = [
    { name: "wt.exe", args: [...cwdArgs, "--", "cmd", "/k", opts.command] },
    { name: "cmd.exe", args: ["/c", "start", "cmd", "/k", opts.command] },
  ];
  return tryCandidates(candidates);
}

function tryCandidates(candidates: Array<{ name: string; args: string[] }>): Promise<LaunchResult> {
  return new Promise((resolve) => {
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        resolve({ ok: false, error: "no supported terminal app found" });
        return;
      }
      const c = candidates[i++]!;
      const child = spawn(c.name, c.args, {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
      });
      let resolved = false;
      child.on("error", () => {
        if (!resolved) tryNext();
      });
      child.on("spawn", () => {
        resolved = true;
        child.unref();
        resolve({ ok: true, terminal: c.name });
      });
    };
    tryNext();
  });
}

function shellEscape(s: string): string {
  // Wrap in double quotes and escape inner double quotes + backslashes.
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}
