/**
 * Persistent task inbox: deduped queue of tasks pulled from external sources.
 *
 * Storage: `~/.config/banyan/state/integrations-inbox.json`. We rewrite the
 * whole file on every mutation — the inbox stays small (capped to 200 active
 * entries) and the simplicity beats the marginal IO cost.
 *
 * Each entry tracks lifecycle:
 *   - firstSeenAt   — when banyan first observed it
 *   - lastSeenAt    — last poll that still saw the task
 *   - spawnedAt     — if the user clicked "spawn" → moved to history (kept for audit)
 *   - dismissedAt   — if the user clicked "dismiss" → won't re-surface
 *
 * The dedup key is `Task.id`, which is `<sourceName>:<externalId>` by
 * convention — see how providers build it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Task } from "./types.js";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");
const INBOX_PATH = path.join(STATE_DIR, "integrations-inbox.json");

const MAX_ACTIVE = 200;

export interface InboxEntry {
  task: Task;
  firstSeenAt: string;
  lastSeenAt: string;
  /** ISO ts + project + feature once the user has spawned an agent. */
  spawnedAt?: string;
  spawnedProject?: string;
  spawnedFeature?: string;
  /** ISO ts when dismissed. Dismissed entries are kept for audit but hidden by default. */
  dismissedAt?: string;
  /** Free-form note left by the user when dismissing. */
  dismissNote?: string;
  /** Optional suggested project / mode from the matching IntegrationRule. */
  suggestedProject?: string;
  suggestedMode?: string;
}

interface InboxFile {
  version: 1;
  entries: InboxEntry[];
}

function readFile(): InboxFile {
  if (!existsSync(INBOX_PATH)) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(INBOX_PATH, "utf8")) as InboxFile;
    if (!parsed || !Array.isArray(parsed.entries)) {
      return { version: 1, entries: [] };
    }
    return parsed;
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeFile(file: InboxFile): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(INBOX_PATH, JSON.stringify(file, null, 2) + "\n", "utf8");
}

/** Merge a fresh pull from one source into the inbox. Returns the count of
 *  newly added entries (i.e. tasks banyan had never seen). */
export function upsertPull(
  sourceName: string,
  pulled: Task[],
  suggest: { project?: string; mode?: string } = {},
): { added: number; refreshed: number } {
  const file = readFile();
  const byId = new Map(file.entries.map((e) => [e.task.id, e] as const));
  const now = new Date().toISOString();
  let added = 0;
  let refreshed = 0;

  for (const t of pulled) {
    if (t.source !== sourceName) continue; // safety: don't allow cross-source spoofing
    const existing = byId.get(t.id);
    if (existing) {
      existing.task = t; // refresh title/status in case the user renamed it provider-side
      existing.lastSeenAt = now;
      refreshed++;
    } else {
      file.entries.push({
        task: t,
        firstSeenAt: now,
        lastSeenAt: now,
        ...(suggest.project ? { suggestedProject: suggest.project } : {}),
        ...(suggest.mode ? { suggestedMode: suggest.mode } : {}),
      });
      added++;
    }
  }

  // Cap: drop oldest dismissed/spawned entries when we exceed MAX_ACTIVE.
  if (file.entries.length > MAX_ACTIVE) {
    file.entries.sort((a, b) => {
      const aRecent = a.spawnedAt || a.dismissedAt || a.firstSeenAt;
      const bRecent = b.spawnedAt || b.dismissedAt || b.firstSeenAt;
      // Active first (no spawnedAt / dismissedAt), then by recency desc.
      const aActive = !a.spawnedAt && !a.dismissedAt;
      const bActive = !b.spawnedAt && !b.dismissedAt;
      if (aActive !== bActive) return aActive ? -1 : 1;
      return bRecent.localeCompare(aRecent);
    });
    file.entries = file.entries.slice(0, MAX_ACTIVE);
  }

  writeFile(file);
  return { added, refreshed };
}

export interface ReadInboxOpts {
  /** Include spawned/dismissed entries (default: false → only active). */
  includeArchived?: boolean;
  /** Filter to a specific source. */
  source?: string;
  /** Cap. Default 100. */
  limit?: number;
}

/** Read inbox entries newest-first. */
export function readInbox(opts: ReadInboxOpts = {}): InboxEntry[] {
  const file = readFile();
  let entries = file.entries.slice();
  if (!opts.includeArchived) {
    entries = entries.filter((e) => !e.spawnedAt && !e.dismissedAt);
  }
  if (opts.source) {
    entries = entries.filter((e) => e.task.source === opts.source);
  }
  entries.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
  if (opts.limit) entries = entries.slice(0, opts.limit);
  return entries;
}

export function markSpawned(taskId: string, project: string, feature: string): boolean {
  const file = readFile();
  const e = file.entries.find((x) => x.task.id === taskId);
  if (!e) return false;
  e.spawnedAt = new Date().toISOString();
  e.spawnedProject = project;
  e.spawnedFeature = feature;
  writeFile(file);
  return true;
}

export function markDismissed(taskId: string, note?: string): boolean {
  const file = readFile();
  const e = file.entries.find((x) => x.task.id === taskId);
  if (!e) return false;
  e.dismissedAt = new Date().toISOString();
  if (note) e.dismissNote = note;
  writeFile(file);
  return true;
}

export function inboxPath(): string {
  return INBOX_PATH;
}
