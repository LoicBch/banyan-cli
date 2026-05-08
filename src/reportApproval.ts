/**
 * Per-feature report-approval state — does the user agree with the latest
 * report or did they reject it?
 *
 * Mirrors `src/approval.ts` (which gates plans) but for end-of-task
 * reports. Lives in its own file so the two state machines stay clean.
 *
 * Layout: ~/.config/banyan/state/<project>.<feature>.report-approval.json
 *
 * The "pending" status is derived: a report exists whose timestamp is
 * newer than the most recent approve/reject decision. If a fresh report
 * is submitted after a decision, the prior decision becomes stale and
 * the status flips back to pending — same pattern as plan re-submission.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { readReports } from "./reports.js";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");

export interface ReportApprovalState {
  project: string;
  feature: string;
  /** Timestamp of the report the decision applies to. */
  reviewedReportTs: string;
  decision: "approved" | "rejected";
  decidedAt: string;
  rejectionNote: string | null;
}

export type ReportApprovalStatus =
  | "no-report-yet"
  | "pending"          // a report awaits user decision
  | "approved"         // latest report has been approved
  | "rejected";        // latest report was rejected (agent should revise)

function reportApprovalPath(project: string, feature: string): string {
  return path.join(STATE_DIR, `${project}.${feature}.report-approval.json`);
}

export function getReportApproval(
  project: string,
  feature: string,
): ReportApprovalState | undefined {
  const p = reportApprovalPath(project, feature);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ReportApprovalState;
  } catch {
    return undefined;
  }
}

function save(state: ReportApprovalState): ReportApprovalState {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    reportApprovalPath(state.project, state.feature),
    JSON.stringify(state, null, 2),
    "utf8",
  );
  return state;
}

export function approveReport(
  project: string,
  feature: string,
  reportTs: string,
): ReportApprovalState {
  return save({
    project,
    feature,
    reviewedReportTs: reportTs,
    decision: "approved",
    decidedAt: new Date().toISOString(),
    rejectionNote: null,
  });
}

export function rejectReport(
  project: string,
  feature: string,
  reportTs: string,
  note?: string,
): ReportApprovalState {
  return save({
    project,
    feature,
    reviewedReportTs: reportTs,
    decision: "rejected",
    decidedAt: new Date().toISOString(),
    rejectionNote: note?.trim() || "(no reason given)",
  });
}

export function deleteReportApproval(project: string, feature: string): void {
  const p = reportApprovalPath(project, feature);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

/** Derive the pending status by comparing the latest report's ts with the
 *  decision file. Decision applies only to its specific reportTs — if a
 *  fresh report has been submitted since, the status is "pending" again. */
export function reportApprovalStatus(
  project: string,
  feature: string,
): { status: ReportApprovalStatus; latestReportTs: string | null; state: ReportApprovalState | undefined } {
  const reports = readReports(project, { feature });
  if (reports.length === 0) {
    return { status: "no-report-yet", latestReportTs: null, state: undefined };
  }
  const latest = reports[reports.length - 1]!;
  const state = getReportApproval(project, feature);
  if (!state || state.reviewedReportTs !== latest.ts) {
    return { status: "pending", latestReportTs: latest.ts, state };
  }
  return { status: state.decision, latestReportTs: latest.ts, state };
}
