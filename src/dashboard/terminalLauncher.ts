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

/** Find which terminal app currently holds an attached tmux client for the
 *  given session. Walks: tmux client tty → lsof PID → process tree → first
 *  ancestor whose name matches a known terminal app. Returns the .app name
 *  on macOS (suitable for `tell application "<name>"`) or null when no
 *  match. Best-effort; failures fall through to the iTerm/Terminal default. */
async function detectAttachedTerminalApp(session: string): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    // Get the tty of the most-recently-attached client. Format example:
    //   "/dev/ttys009 1733764800 1 [80x24] (utf-8) ..."
    const { stdout } = await execFileP(
      "tmux",
      ["list-clients", "-t", session, "-F", "#{client_tty}"],
      { encoding: "utf8" },
    );
    const tty = stdout.split("\n").map((s) => s.trim()).find((s) => s.length > 0);
    if (!tty) return null;

    // lsof: which pid has the tty open. Filter to processes ("-c") that
    // own the device. Then walk up the ancestor chain via `ps -o ppid`
    // looking for a known terminal app binary.
    const { stdout: lsofOut } = await execFileP("lsof", ["-t", tty], { encoding: "utf8" });
    const pids = lsofOut.split("\n").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
    for (const pid of pids) {
      const app = await walkProcessTreeForTerminal(pid);
      if (app) return app;
    }
    return null;
  } catch {
    return null;
  }
}

const KNOWN_TERMINAL_APPS: Record<string, string> = {
  // Map process-name substrings (case-insensitive) → AppleScript app name.
  warp: "Warp",
  iterm: "iTerm",
  iterm2: "iTerm",
  ghostty: "Ghostty",
  alacritty: "Alacritty",
  wezterm: "WezTerm",
  kitty: "kitty",
  hyper: "Hyper",
  terminal: "Terminal", // Terminal.app — fallback last in the dict order
};

async function walkProcessTreeForTerminal(pid: string): Promise<string | null> {
  let current = pid;
  for (let i = 0; i < 16; i++) {
    try {
      const { stdout } = await execFileP(
        "ps",
        ["-o", "ppid=,comm=", "-p", current],
        { encoding: "utf8" },
      );
      const line = stdout.trim();
      if (!line) return null;
      const [ppidStr, ...commParts] = line.split(/\s+/);
      const comm = commParts.join(" ").toLowerCase();
      for (const [needle, appName] of Object.entries(KNOWN_TERMINAL_APPS)) {
        if (comm.includes(needle)) return appName;
      }
      if (!ppidStr || ppidStr === "0" || ppidStr === "1") return null;
      current = ppidStr;
    } catch {
      return null;
    }
  }
  return null;
}

export async function openTerminalWindow(opts: LaunchOptions): Promise<LaunchResult> {
  // Short-circuit when an existing terminal is already attached to the tmux
  // session for this project. Saves the user from a redundant second window.
  if (opts.existingTmuxSession) {
    const attached = await sessionHasAttachedClient(opts.existingTmuxSession);
    if (attached) {
      const detected = await detectAttachedTerminalApp(opts.existingTmuxSession);
      const r = await bringTerminalToFront(detected);
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

/** Activate the terminal app holding the attached tmux client, so the user
 *  can switch to it instead of getting a second window. `detected` comes
 *  from `detectAttachedTerminalApp` (process-tree walk); if null we fall
 *  back to iTerm/Terminal.app heuristic. No-op on Linux/Windows where
 *  raising a specific window without a desktop-env hook is unreliable. */
async function bringTerminalToFront(detected: string | null): Promise<LaunchResult> {
  if (process.platform === "darwin") {
    const target = detected ?? (existsSync("/Applications/iTerm.app") ? "iTerm" : "Terminal");
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
