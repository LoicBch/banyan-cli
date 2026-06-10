/**
 * Plan-approval gate. The feature agent requests approval after planning;
 * the orchestrator (or user) approves/rejects. Report approval lives in
 * api/report.ts since reports are end-of-task, not pre-work.
 */
import {
  requestApproval,
  approvePlan,
  rejectPlan,
  getApproval,
  approvalStatus,
  type ApprovalState,
  type ApprovalStatus,
} from "../../approval.js";
import { validateProject } from "./shared.js";

export async function requestPlanApproval(
  projectName: string,
  feature: string,
): Promise<{ ok: true; state: ApprovalState }> {
  await validateProject(projectName);
  const state = requestApproval(projectName, feature);
  return { ok: true, state };
}

export async function approveFeaturePlan(
  projectName: string,
  feature: string,
): Promise<{ ok: true; state: ApprovalState }> {
  await validateProject(projectName);
  const state = approvePlan(projectName, feature);
  return { ok: true, state };
}

export async function rejectFeaturePlan(
  projectName: string,
  feature: string,
  note?: string,
): Promise<{ ok: true; state: ApprovalState }> {
  await validateProject(projectName);
  const state = rejectPlan(projectName, feature, note);
  return { ok: true, state };
}

export async function getFeatureApproval(
  projectName: string,
  feature: string,
): Promise<{ state: ApprovalState | null; status: ApprovalStatus }> {
  await validateProject(projectName);
  const state = getApproval(projectName, feature);
  return { state: state ?? null, status: approvalStatus(state) };
}
