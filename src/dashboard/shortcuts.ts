/**
 * Shortcut config: read/write the user's tmux key bindings for banyan actions.
 *
 * Source of truth = `~/.config/banyan/shortcuts.json`, a map of
 * `actionId → chord` (e.g. { "merge": "M-m" }). Defaults are baked-in below
 * (kept in sync with `tmux/banyan.conf`). On save we:
 *   1. validate (format `M-<letter|?>`, no duplicates)
 *   2. write the JSON file
 *   3. regenerate `~/.config/banyan/banyan.tmux.conf` from scratch
 *   4. apply live via `tmux unbind-key` (old chords) + `tmux source-file`
 *      (no-op + warning when tmux isn't running)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../exec.js";

export interface ActionDef {
  id: string;
  label: string;
  description: string;
  defaultChord: string;
}

/** All actions exposed in the Shortcuts tab. Order is preserved for display. */
export const ACTIONS: readonly ActionDef[] = [
  { id: "merge",        defaultChord: "M-m", label: "Merge",         description: "merge the worktree of the current pane (or prompt)" },
  { id: "cleanup",      defaultChord: "M-c", label: "Cleanup",       description: "cleanup the worktree of the current pane (or prompt)" },
  { id: "rebase",       defaultChord: "M-r", label: "Rebase",        description: "rebase the worktree on its base branch" },
  { id: "test",         defaultChord: "M-t", label: "Test",          description: "test the current feature across its repos" },
  { id: "deploy",       defaultChord: "M-d", label: "Deploy",        description: "deploy the current project / repo" },
  { id: "new-worktree", defaultChord: "M-w", label: "New worktree",  description: "create a new worktree (asks for feature name)" },
  { id: "list",         defaultChord: "M-l", label: "List worktrees", description: "popup: list all worktrees" },
  { id: "status",       defaultChord: "M-s", label: "Status",        description: "popup: project status" },
  { id: "info",         defaultChord: "M-i", label: "Info",          description: "popup: project info" },
  { id: "help",         defaultChord: "M-?", label: "Help",          description: "popup: list all banyan shortcuts" },
] as const;

export type Bindings = Record<string, string>;

const CONFIG_DIR = path.join(homedir(), ".config", "banyan");
const SHORTCUTS_JSON = path.join(CONFIG_DIR, "shortcuts.json");
const TMUX_CONF = path.join(CONFIG_DIR, "banyan.tmux.conf");

export interface ReadResult {
  bindings: Bindings;
  defaults: Bindings;
  configPath: string;
  tmuxConfPath: string;
}

export function defaultBindings(): Bindings {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, a.defaultChord]));
}

export function readBindings(): ReadResult {
  const defaults = defaultBindings();
  let stored: Bindings = {};
  if (existsSync(SHORTCUTS_JSON)) {
    try {
      const raw = JSON.parse(readFileSync(SHORTCUTS_JSON, "utf8")) as unknown;
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof v === "string") stored[k] = v;
        }
      }
    } catch {
      // Corrupt JSON: fall back to defaults silently. A subsequent save will
      // overwrite with valid content.
      stored = {};
    }
  }
  // Merge: defaults provide the floor; only known action ids are kept.
  const bindings: Bindings = {};
  for (const a of ACTIONS) {
    bindings[a.id] = stored[a.id] ?? defaults[a.id]!;
  }
  return { bindings, defaults, configPath: SHORTCUTS_JSON, tmuxConfPath: TMUX_CONF };
}

export interface SaveResult {
  ok: boolean;
  error?: string;
  applied?: "live" | "needs-restart";
  message?: string;
}

const CHORD_RE = /^M-([a-zA-Z0-9?])$/;

export function validateBindings(input: Bindings): string | null {
  const known = new Set(ACTIONS.map((a) => a.id));
  const seen = new Map<string, string>();
  for (const [id, chord] of Object.entries(input)) {
    if (!known.has(id)) return `unknown action: ${id}`;
    if (!CHORD_RE.test(chord)) {
      return `invalid chord '${chord}' for ${id} — expected 'M-<letter|digit|?>'`;
    }
    const prev = seen.get(chord);
    if (prev) return `duplicate chord '${chord}' used by '${prev}' and '${id}'`;
    seen.set(chord, id);
  }
  // Every action must have a chord.
  for (const a of ACTIONS) {
    if (!input[a.id]) return `missing chord for action: ${a.id}`;
  }
  return null;
}

/** Resolve the directory shipping the banyan tmux scripts (banyan-current-action.sh, …). */
function findTmuxScriptsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../tmux"),    // dist/src/dashboard → dist/tmux
    path.resolve(here, "../../../tmux"), // dev: src/dashboard → repo/tmux
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, "banyan-current-action.sh"))) return c;
  }
  // Fall back to whatever the dist tmux dir would be — generation will still
  // write paths, they just may not resolve. The user gets a clear error from
  // tmux when sourcing the conf.
  return candidates[0]!;
}

function bindLine(actionId: string, chord: string, scriptsDir: string): string {
  const ca = (a: string) => `run-shell "${scriptsDir}/banyan-current-action.sh ${a}"`;
  const cmd: Record<string, string> = {
    "merge":        ca("merge"),
    "cleanup":      ca("cleanup"),
    "rebase":       ca("rebase"),
    "test":         ca("test"),
    "deploy":       ca("deploy"),
    "new-worktree":
      `command-prompt -p "feature name:,repos (space-sep, empty = all):" ` +
      `"run-shell '${scriptsDir}/banyan-new-worktree.sh %1 %2'"`,
    "list":   `display-popup -E -w 80% -h 60% "bn wt-ls 2>&1 | less -R"`,
    "status": `display-popup -E -w 60% -h 40% "bn status 2>&1 | less -R"`,
    "info":   `display-popup -E -w 70% -h 60% "bn info 2>&1 | less -R"`,
    "help":   `display-popup -E -w 55% -h 60% "${scriptsDir}/banyan-shortcuts-help.sh | less -R"`,
  };
  const body = cmd[actionId];
  if (!body) return `# unknown action: ${actionId}`;
  return `bind-key -n ${chord} ${body}`;
}

function renderTmuxConf(bindings: Bindings, scriptsDir: string): string {
  const header = [
    "# banyan.tmux.conf — generated by the dashboard.",
    "# Edits to this file will be overwritten on the next save.",
    "# To customize permanently, use the Shortcuts tab in `bn serve`.",
    "",
  ].join("\n");
  const lines = ACTIONS.map((a) => bindLine(a.id, bindings[a.id]!, scriptsDir));
  return header + lines.join("\n") + "\n";
}

async function tmuxRunning(): Promise<boolean> {
  try {
    const r = await run("tmux", ["info"], {});
    return r.code === 0;
  } catch {
    return false;
  }
}

async function runQuiet(cmd: string, args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  try {
    return await run(cmd, args, {});
  } catch (err) {
    return { code: 127, stderr: err instanceof Error ? err.message : String(err), stdout: "" };
  }
}

async function applyLive(
  previousBindings: Bindings,
  newBindings: Bindings,
  tmuxConfPath: string,
): Promise<{ applied: "live" | "needs-restart"; message?: string }> {
  if (!(await tmuxRunning())) {
    return { applied: "needs-restart", message: "tmux not running — start tmux to pick up new bindings" };
  }
  // Unbind any chord that was previously bound but is now changed or unused.
  const oldChords = new Set(Object.values(previousBindings));
  const newChords = new Set(Object.values(newBindings));
  for (const chord of oldChords) {
    if (!newChords.has(chord)) {
      await runQuiet("tmux", ["unbind-key", "-n", chord]);
    }
  }
  // Re-source the new conf — bind-key overrides any current binding.
  const src = await runQuiet("tmux", ["source-file", tmuxConfPath]);
  if (src.code !== 0) {
    return {
      applied: "needs-restart",
      message: `tmux source-file failed: ${src.stderr.trim() || src.stdout.trim()}`,
    };
  }
  return { applied: "live" };
}

export async function writeBindings(input: Bindings): Promise<SaveResult> {
  const err = validateBindings(input);
  if (err) return { ok: false, error: err };

  const previous = readBindings().bindings;
  const scriptsDir = findTmuxScriptsDir();

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(SHORTCUTS_JSON, JSON.stringify(input, null, 2) + "\n", "utf8");
  writeFileSync(TMUX_CONF, renderTmuxConf(input, scriptsDir), "utf8");

  const live = await applyLive(previous, input, TMUX_CONF);
  return { ok: true, applied: live.applied, message: live.message };
}
