import { logger } from "../logger.js";
import { getProject, type Config } from "../config.js";
import * as naming from "../naming.js";
import {
  approvalStatus,
  approvePlan,
  getApproval,
  rejectPlan,
} from "../approval.js";
import {
  approveReport,
  rejectReport,
  reportApprovalStatus,
} from "../reportApproval.js";
import { getTodo } from "../todo.js";
import { UsageError } from "../errors.js";

export interface ApproveOpts {
  /** If set, reject instead of approving. Optional value is the reason. */
  reject?: string | boolean;
  /** Show pending state without mutating. */
  show?: boolean;
}

/**
 * `bn <p> approve <branch>` is contextual: it approves whatever stage of
 * the feature lifecycle is currently awaiting user decision.
 *
 *   - plan pending review     → approve / reject the plan
 *   - report pending review   → approve / reject the report
 *   - both pending            → unusual; plan takes precedence (you can't
 *                                review a report on a plan you haven't yet
 *                                approved). Plan first.
 *   - nothing pending         → error "nothing to decide on right now"
 *
 * The output makes clear what was decided so the user is never surprised.
 */
export async function approveCmd(
  config: Config,
  projectName: string,
  inputFeature: string,
  opts: ApproveOpts = {},
): Promise<void> {
  const project = getProject(config, projectName);
  const feature = await naming.resolveProjectFeatureKey(project, inputFeature);

  const planState = getApproval(projectName, feature);
  const planStatus = approvalStatus(planState);
  const report = reportApprovalStatus(projectName, feature);

  if (opts.show) {
    showState(projectName, feature, planStatus, planState, report);
    return;
  }

  // Pick the active gate. Plan precedes report in the lifecycle, so if both
  // are pending we approve the plan first.
  const isReject = opts.reject !== undefined && opts.reject !== false;
  const note = typeof opts.reject === "string" ? opts.reject : undefined;

  if (planStatus === "pending") {
    if (isReject) {
      const s = rejectPlan(projectName, feature, note);
      logger.ok(`plan rejected for ${projectName}/${feature}${note ? `: ${note}` : ""}`);
      logger.info(`agent will revise on its next turn (state: ${approvalStatus(s)})`);
    } else {
      const s = approvePlan(projectName, feature);
      logger.ok(`plan approved for ${projectName}/${feature} (at ${s.approvedAt})`);
      logger.info(`agent will start working on its next turn`);
    }
    return;
  }

  if (report.status === "pending") {
    if (!report.latestReportTs) {
      throw new UsageError(`no report to ${isReject ? "reject" : "approve"} for ${projectName}/${feature}`);
    }
    if (isReject) {
      rejectReport(projectName, feature, report.latestReportTs, note);
      logger.ok(`report rejected for ${projectName}/${feature}${note ? `: ${note}` : ""}`);
      logger.info(`go back to the agent: bn ${projectName} task ${feature} "${note ?? "see rejection"}"`);
    } else {
      approveReport(projectName, feature, report.latestReportTs);
      logger.ok(`report approved for ${projectName}/${feature}`);
      logger.info(`ready to merge: bn ${projectName} merge ${feature}`);
    }
    return;
  }

  // Nothing pending.
  throw new UsageError(
    `nothing pending for ${projectName}/${feature}. ` +
      `plan: ${planStatus}, report: ${report.status}.`,
  );
}

function showState(
  projectName: string,
  feature: string,
  planStatus: string,
  planState: ReturnType<typeof getApproval>,
  report: ReturnType<typeof reportApprovalStatus>,
): void {
  const todo = getTodo(projectName, feature);
  logger.info(``);
  logger.info(`── ${projectName}/${feature} ──`);
  logger.info(`plan:   ${planStatus}`);
  if (planState) {
    if (planState.planSubmittedAt) logger.info(`  submitted: ${planState.planSubmittedAt}`);
    if (planState.approvedAt) logger.info(`  approved:  ${planState.approvedAt}`);
    if (planState.rejectionNote) logger.info(`  rejection: ${planState.rejectionNote}`);
  }
  logger.info(`report: ${report.status}`);
  if (report.state) {
    logger.info(`  reviewed report: ${report.state.reviewedReportTs}`);
    logger.info(`  decided at:      ${report.state.decidedAt}`);
    if (report.state.rejectionNote) logger.info(`  rejection:       ${report.state.rejectionNote}`);
  } else if (report.latestReportTs) {
    logger.info(`  latest report:   ${report.latestReportTs} (no decision yet)`);
  }
  if (todo) {
    const done = todo.items.filter((it) => it.done).length;
    logger.info(``);
    logger.info(`TODO (${done}/${todo.items.length}):`);
    for (const it of todo.items) {
      const mark = it.done ? "[x]" : "[ ]";
      logger.info(`  ${mark} ${it.id}. ${it.text}`);
    }
  }
}
