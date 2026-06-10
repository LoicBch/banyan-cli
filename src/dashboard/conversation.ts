/**
 * Read + tail a per-feature claude conversation transcript.
 *
 * Each per-feature claude session writes its conversation log to
 * `~/.claude/projects/<encoded-cwd>/<sessionUuid>.jsonl`, with one
 * event per line (`{type: "user"|"assistant", message: {...}}`). This
 * module:
 *
 *   1. Locates the right transcript file for a (project, feature) pair
 *      by walking the candidate cwds (each repo's worktree path).
 *   2. Parses the JSONL into a normalized `ChatMessage[]` the dashboard
 *      can render as chat bubbles.
 *   3. Watches the file for appends and streams new messages via SSE.
 *
 * Why not the full raw JSON? The transcripts contain tool calls,
 * thinking blocks, file diffs — too noisy for a chat UI. We extract
 * just the user prompts + assistant text responses, keeping the
 * substance and dropping the plumbing.
 */
import { existsSync, readFileSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as naming from "../naming.js";
import { getProject, type Config } from "../config.js";

export interface ChatMessage {
  /** Stable id per message — index in the source file's events array.
   *  Lets the SSE client dedupe + the SPA key React children. */
  id: string;
  ts: string;
  role: "user" | "assistant";
  /** Plain text content. Tool calls / thinking / images are stripped. */
  text: string;
}

/** Locate the transcript file for a (project, feature). Returns the
 *  most-recently-modified `.jsonl` under the worktree's encoded cwd
 *  directory. Returns undefined when no transcript exists yet. */
export function findTranscriptFile(
  config: Config,
  projectName: string,
  feature: string,
): string | undefined {
  const project = getProject(config, projectName);
  const root = path.join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return undefined;

  // Try each repo's worktree path for this feature. The pane's claude
  // process runs with cwd = the worktree path, so that's what claude
  // encodes as the project key.
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    const wt = naming.existingWorktreePath(repo.path, feature) ?? naming.worktreePath(repo.path, feature);
    if (!existsSync(wt)) continue;
    const encoded = encodeCwd(wt);
    const dir = path.join(root, encoded);
    if (!existsSync(dir)) continue;
    const file = pickLatestJsonl(dir);
    if (file) return file;
  }
  return undefined;
}

function encodeCwd(absPath: string): string {
  // Match claude code's storage convention: replace `/` with `-`.
  return absPath.replace(/\//g, "-");
}

function pickLatestJsonl(dir: string): string | undefined {
  let latest: { path: string; mtime: number } | undefined;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const p = path.join(dir, name);
    try {
      const m = statSync(p).mtimeMs;
      if (!latest || m > latest.mtime) latest = { path: p, mtime: m };
    } catch {
      /* skip */
    }
  }
  return latest?.path;
}

/** Read the full transcript and return the chat messages, optionally
 *  capped at the last N to keep the initial render snappy. */
export function readMessages(file: string, limit?: number): ChatMessage[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const out: ChatMessage[] = [];
  for (let i = 0; i < lines.length; i++) {
    const msg = parseLine(lines[i]!, i);
    if (msg) out.push(msg);
  }
  if (limit && out.length > limit) {
    return out.slice(out.length - limit);
  }
  return out;
}

/** Parse one JSONL line into a ChatMessage. Returns null for events
 *  we don't care about (tool results, thinking, system, …). */
function parseLine(line: string, index: number): ChatMessage | null {
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof ev !== "object" || ev === null) return null;
  const e = ev as {
    type?: string;
    timestamp?: string;
    message?: {
      role?: string;
      content?: unknown;
    };
  };
  if (e.type !== "user" && e.type !== "assistant") return null;

  const text = extractText(e.message?.content);
  if (!text || text.trim().length === 0) return null;

  return {
    id: String(index),
    ts: e.timestamp ?? "",
    role: e.type,
    text,
  };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => {
        if (typeof c !== "object" || c === null) return false;
        const x = c as { type?: string };
        return x.type === "text";
      })
      .map((c) => {
        const x = c as { text?: string };
        return typeof x.text === "string" ? x.text : "";
      })
      .join("\n\n")
      .trim();
  }
  return "";
}

/**
 * Watch a transcript file for appends. The callback is invoked every
 * time new lines are added, with the new messages only (not the full
 * file). Returns a `stop()` function the caller uses on disconnect.
 */
export function watchTranscript(
  file: string,
  onAppend: (messages: ChatMessage[]) => void,
): { stop: () => void } {
  let lastSize = 0;
  let lastIndex = 0;
  try {
    lastSize = statSync(file).size;
    // Pre-count the existing events so newly-appended messages get
    // monotonically increasing ids (rather than restarting at 0).
    const initial = readMessages(file);
    lastIndex = initial.length;
  } catch {
    /* ignore */
  }

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(file, { persistent: false }, () => {
      try {
        const stat = statSync(file);
        if (stat.size <= lastSize) {
          lastSize = stat.size;
          return;
        }
        // Read only the appended chunk to avoid re-parsing the whole file.
        // Note: this is best-effort — if the file was rewritten (not just
        // appended) we'll miss state. Claude only appends.
        const fd = readFileSync(file, "utf8").slice(lastSize);
        lastSize = stat.size;
        const newLines = fd.split("\n").filter((l) => l.trim().length > 0);
        const newMessages: ChatMessage[] = [];
        for (const line of newLines) {
          const msg = parseLine(line, lastIndex++);
          if (msg) newMessages.push(msg);
        }
        if (newMessages.length > 0) onAppend(newMessages);
      } catch {
        /* swallow — caller will reconnect */
      }
    });
  } catch {
    /* file doesn't exist or unwatchable — caller can still poll */
  }

  return {
    stop: () => {
      try { watcher?.close(); } catch { /* ignore */ }
    },
  };
}
