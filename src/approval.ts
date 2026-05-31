/**
 * Per-feature plan-approval state.
 *
 * When `requireApproval` is set (CLI `--review-plan`, MCP
 * `requireApproval: true`), banyan inserts a gate between "agent has
 * planned its work" and "agent starts executing":
 *
 *   1. Agent sets up its TODO via `banyan_set_todo`, then calls
 *      `banyan_request_plan_approval` to signal "I'm done planning, ready
 *      for review".
 *   2. The Stop hook gates: as long as the latest plan-submit is not yet
 *      approved, it blocks the agent from working further.
 *   3. The user (or orchestrator) calls `banyan_approve_plan` (or
 *      `bn <p> approve <feature>`) to release the gate. The agent's next
 *      turn proceeds normally.
 *
 * Rejection is handled by stashing a rejection note: the agent's next
 * Stop hook injects "your plan was rejected: <reason>. revise and resubmit
 * via banyan_request_plan_approval."
 *
 * Layout: ~/.config/banyan/state/<project>.<feature>.approval.json
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

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");

export interface ApprovalState {
  project: string;
  feature: string;
  /** ISO timestamp of the most recent plan submission. null if the agent
   *  has not yet called `banyan_request_plan_approval`. */
  planSubmittedAt: string | null;
  /** ISO timestamp of the most recent approval. null if no approval has
   *  been granted, or if a fresher plan was submitted after the last
   *  approval (forcing re-approval). */
  approvedAt: string | null;
  /** Optional rejection note. Cleared when a fresh plan is submitted. */
  rejectionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

function approvalPath(project: string, feature: string): string {
  return path.join(STATE_DIR, `${project}.${feature}.approval.json`);
}

function nowISO(): string {
  return new Date().toISOString();
}

function emptyState(project: string, feature: string): ApprovalState {
  const now = nowISO();
  return {
    project,
    feature,
    planSubmittedAt: null,
    approvedAt: null,
    rejectionNote: null,
    createdAt: now,
    updatedAt: now,
  };
}

function load(project: string, feature: string): ApprovalState | undefined {
  const p = approvalPath(project, feature);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ApprovalState;
  } catch {
    return undefined;
  }
}

function save(state: ApprovalState): ApprovalState {
  mkdirSync(STATE_DIR, { recursive: true });
  state.updatedAt = nowISO();
  writeFileSync(approvalPath(state.project, state.feature), JSON.stringify(state, null, 2), "utf8");
  return state;
}

/** Agent calls this after setting up the TODO list. Records "plan ready
 *  for review" — invalidates any prior approval (forces re-approval if the
 *  plan was already approved once). */
export function requestApproval(project: string, feature: string): ApprovalState {
  const state = load(project, feature) ?? emptyState(project, feature);
  state.planSubmittedAt = nowISO();
  state.approvedAt = null;
  state.rejectionNote = null;
  return save(state);
}

/** User (or orchestrator) marks the latest submitted plan as approved. */
export function approvePlan(project: string, feature: string): ApprovalState {
  const state = load(project, feature) ?? emptyState(project, feature);
  if (!state.planSubmittedAt) {
    throw new Error(
      `no plan submitted for ${project}/${feature} — agent must call banyan_request_plan_approval first`,
    );
  }
  state.approvedAt = nowISO();
  state.rejectionNote = null;
  return save(state);
}

/** User rejects the plan with an optional explanation. The agent's next
 *  Stop hook will inject the rejection note. */
export function rejectPlan(
  project: string,
  feature: string,
  note?: string,
): ApprovalState {
  const state = load(project, feature) ?? emptyState(project, feature);
  state.approvedAt = null;
  state.rejectionNote = note?.trim() || "(no reason given)";
  // Clear planSubmittedAt so the gate becomes "no plan submitted" again
  // (which prompts the agent to revise and resubmit).
  state.planSubmittedAt = null;
  return save(state);
}

export function getApproval(project: string, feature: string): ApprovalState | undefined {
  return load(project, feature);
}

export function deleteApproval(project: string, feature: string): void {
  const p = approvalPath(project, feature);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

export type ApprovalStatus =
  | "no-plan-yet"      // agent hasn't submitted anything
  | "pending"          // plan submitted, awaiting user
  | "approved"         // latest plan is approved
  | "rejected";        // user rejected; agent must resubmit

export function approvalStatus(state: ApprovalState | undefined): ApprovalStatus {
  if (!state) return "no-plan-yet";
  if (state.rejectionNote && !state.planSubmittedAt) return "rejected";
  if (!state.planSubmittedAt) return "no-plan-yet";
  if (state.approvedAt && state.approvedAt >= state.planSubmittedAt) return "approved";
  return "pending";
}
