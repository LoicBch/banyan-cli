/**
 * End-of-task reports — agent submission + orchestrator approval.
 *
 * Distinct from plan approval (api/approval.ts): plan is pre-work, reports
 * are post-work. Different state files, different lifecycle moment.
 */
import { getProject } from "../../config.js";
import {
  appendReport,
  readReports,
  type ReportInput,
  type FeatureReport,
} from "../../reports.js";
import {
  approveReport,
  rejectReport,
  reportApprovalStatus,
  type ReportApprovalState,
  type ReportApprovalStatus,
} from "../../reportApproval.js";
import { UsageError } from "../../errors.js";
import { getConfig, validateProject } from "./shared.js";

/**
 * Submit an end-of-task report for a feature. Validates the project exists,
 * then appends to the project's timeline. Multiple reports per feature are
 * allowed (status updates, v1 / v2 of "done") — the timeline keeps history.
 */
export async function reportDone(
  projectName: string,
  feature: string,
  input: ReportInput,
): Promise<{ ok: true; ts: string }> {
  const config = await getConfig();
  getProject(config, projectName); // validates project exists, throws otherwise
  if (!input.summary || !input.summary.trim()) {
    throw new UsageError("summary is required");
  }
  if (!input.testInstructions || !input.testInstructions.trim()) {
    throw new UsageError("testInstructions is required");
  }
  const record = appendReport(projectName, feature, input);
  return { ok: true, ts: record.ts };
}

/**
 * Read reports from a project's timeline. Optional filters: by feature,
 * by date (ISO timestamp), and `latestOnly` to collapse to one per feature.
 */
export async function listReports(
  projectName: string,
  opts: { feature?: string; since?: string; latestOnly?: boolean } = {},
): Promise<{ reports: FeatureReport[] }> {
  const config = await getConfig();
  getProject(config, projectName);
  return { reports: readReports(projectName, opts) };
}

export async function approveFeatureReport(
  projectName: string,
  feature: string,
): Promise<{ ok: true; state: ReportApprovalState }> {
  await validateProject(projectName);
  const r = reportApprovalStatus(projectName, feature);
  if (!r.latestReportTs) {
    throw new UsageError(`no report submitted for ${projectName}/${feature}`);
  }
  return { ok: true, state: approveReport(projectName, feature, r.latestReportTs) };
}

export async function rejectFeatureReport(
  projectName: string,
  feature: string,
  note?: string,
): Promise<{ ok: true; state: ReportApprovalState }> {
  await validateProject(projectName);
  const r = reportApprovalStatus(projectName, feature);
  if (!r.latestReportTs) {
    throw new UsageError(`no report submitted for ${projectName}/${feature}`);
  }
  return {
    ok: true,
    state: rejectReport(projectName, feature, r.latestReportTs, note),
  };
}

export async function getFeatureReportApproval(
  projectName: string,
  feature: string,
): Promise<{
  status: ReportApprovalStatus;
  latestReportTs: string | null;
  state: ReportApprovalState | null;
}> {
  await validateProject(projectName);
  const r = reportApprovalStatus(projectName, feature);
  return {
    status: r.status,
    latestReportTs: r.latestReportTs,
    state: r.state ?? null,
  };
}
