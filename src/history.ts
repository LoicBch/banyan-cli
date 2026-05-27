/**
 * Append-only event log per project. Captures every successful banyan
 * action so the dashboard's History tab can reconstruct what shipped,
 * in what order, across which repos — without re-parsing git log.
 *
 * Storage: ~/.config/banyan/state/<project>.history.jsonl
 *
 * Events are intentionally write-once: no edits, no deletes. If the
 * action's outcome turns out to be wrong (e.g. a "merge" event written
 * but the upstream branch was force-pushed afterwards), that's a
 * downstream concern, not the recorder's.
 *
 * Failures to write MUST NOT break the action that triggered them.
 * Wrap every call site in try/catch.
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");

export type HistoryEventKind = "merge" | "cleanup" | "rebase";

interface BaseEvent {
  ts: string; // ISO 8601
  kind: HistoryEventKind;
  project: string;
  feature: string;
  repo: string;
}

export interface MergeEvent extends BaseEvent {
  kind: "merge";
  base: string;
  /** `local` = `bn merge --local`; otherwise the PR/MR flow. */
  local?: boolean;
  /** Merge strategy actually used (squash/merge/rebase). */
  strategy?: string;
  /** Set when going through the PR/MR flow. */
  mrUrl?: string;
  mrNumber?: number;
  provider?: "github" | "gitlab";
  /** MR title / body / diff stats captured from the provider at merge time.
   *  Frozen in the log so the History view stays readable even after the
   *  MR is edited or the source branch is deleted. All fields best-effort. */
  mrTitle?: string;
  mrBody?: string;
  mrAuthor?: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
}

export interface CleanupEvent extends BaseEvent {
  kind: "cleanup";
  /** `true` when the user passed --force. */
  forced?: boolean;
}

export interface RebaseEvent extends BaseEvent {
  kind: "rebase";
  base: string;
  /** Wall-clock duration of the rebase, ms. */
  durationMs?: number;
  /** Set when the resolver kicked in. */
  conflictResolved?: boolean;
}

export type HistoryEvent = MergeEvent | CleanupEvent | RebaseEvent;

/** Input type for callers — they don't supply `ts` (we stamp it). */
export type HistoryEventInput =
  | Omit<MergeEvent, "ts">
  | Omit<CleanupEvent, "ts">
  | Omit<RebaseEvent, "ts">;

function historyPath(projectName: string): string {
  return path.join(STATE_DIR, `${projectName}.history.jsonl`);
}

/** Append one event. Returns the stored record. Throws on filesystem
 *  failure — callers should wrap in try/catch when called from an action
 *  hot path so a write error doesn't break the user's command. */
export function appendHistoryEvent(input: HistoryEventInput): HistoryEvent {
  mkdirSync(STATE_DIR, { recursive: true });
  const record = { ts: new Date().toISOString(), ...input } as HistoryEvent;
  appendFileSync(
    historyPath(record.project),
    JSON.stringify(record) + "\n",
    "utf8",
  );
  return record;
}

export interface ReadHistoryOpts {
  feature?: string;
  kind?: HistoryEventKind;
  /** ISO timestamp; only events at-or-after this point. */
  since?: string;
  limit?: number;
}

/** Read events newest-first, with optional filters. */
export function readHistoryEvents(
  projectName: string,
  opts: ReadHistoryOpts = {},
): HistoryEvent[] {
  const p = historyPath(projectName);
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, "utf8");
  const out: HistoryEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const ev = JSON.parse(line) as HistoryEvent;
      if (opts.feature && ev.feature !== opts.feature) continue;
      if (opts.kind && ev.kind !== opts.kind) continue;
      if (opts.since && ev.ts < opts.since) continue;
      out.push(ev);
    } catch {
      // skip a single corrupt line
    }
  }
  // Newest first; cap.
  out.reverse();
  if (opts.limit && out.length > opts.limit) return out.slice(0, opts.limit);
  return out;
}
