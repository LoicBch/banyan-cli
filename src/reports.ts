/**
 * End-of-task reports submitted by per-feature Claude agents.
 *
 * Append-only JSONL — one line per report, never rewritten. Provides a
 * grep-able timeline of what every agent thinks it accomplished, with
 * structured fields the dashboard and orchestrator can consume.
 *
 * Layout: ~/.config/banyan/state/<project>.reports.jsonl
 *
 * Why JSONL: the timeline IS the file. No DB, no migrations, durable,
 * `tail -f` and `jq` work out of the box. An agent can submit multiple
 * reports for the same feature (status updates, v1 / v2 of "done") and
 * we keep them all — the latest wins for dashboard "current status",
 * but the history is intact.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");

export type ReportStatus = "done" | "blocked" | "needs_review";

export interface ReportCommit {
  sha: string;
  message: string;
}

/** What an agent submits via `banyan_report_done`. The `ts`, `project`,
 *  `feature` fields are added by the storage layer, not the caller. */
export interface ReportInput {
  status: ReportStatus;
  summary: string;
  testInstructions: string;
  hesitations?: string[];
  openQuestions?: string[];
  risks?: string[];
  filesChanged?: string[];
  commits?: ReportCommit[];
}

export interface FeatureReport extends ReportInput {
  ts: string; // ISO 8601
  project: string;
  feature: string;
}

function reportsPath(project: string): string {
  return path.join(STATE_DIR, `${project}.reports.jsonl`);
}

/** Append a single report to the project's timeline. Creates the file
 *  on first use. Returns the stored record (with ts/project/feature). */
export function appendReport(
  project: string,
  feature: string,
  input: ReportInput,
): FeatureReport {
  mkdirSync(STATE_DIR, { recursive: true });
  const record: FeatureReport = {
    ts: new Date().toISOString(),
    project,
    feature,
    ...input,
  };
  appendFileSync(reportsPath(project), JSON.stringify(record) + "\n", "utf8");
  return record;
}

export interface ReadReportsOpts {
  /** Filter to a single feature. */
  feature?: string;
  /** Only return reports submitted at-or-after this ISO timestamp. */
  since?: string;
  /** Only return the latest report per feature (one row per feature). */
  latestOnly?: boolean;
}

/** Read all reports for a project. Reports are returned in submission
 *  order (oldest first). Malformed lines are silently skipped. */
export function readReports(
  project: string,
  opts: ReadReportsOpts = {},
): FeatureReport[] {
  const p = reportsPath(project);
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, "utf8");

  const all: FeatureReport[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const r = JSON.parse(line) as FeatureReport;
      if (opts.feature && r.feature !== opts.feature) continue;
      if (opts.since && r.ts < opts.since) continue;
      all.push(r);
    } catch {
      // skip malformed line
    }
  }

  if (!opts.latestOnly) return all;

  // De-dupe to the latest per feature, keeping submission order of those
  // latest entries. Walk from the end so the first-seen wins, then reverse.
  const seen = new Set<string>();
  const latest: FeatureReport[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const r = all[i]!;
    if (seen.has(r.feature)) continue;
    seen.add(r.feature);
    latest.push(r);
  }
  return latest.reverse();
}
