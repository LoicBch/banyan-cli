import { logger } from "../logger.js";
import {
  approvalStatus,
  approvePlan,
  getApproval,
  rejectPlan,
} from "../approval.js";
import { getTodo } from "../todo.js";
import { UsageError } from "../errors.js";

export interface ApproveOpts {
  /** If set, reject the plan instead of approving. The optional value is
   *  the reason; pass an empty string for "no reason given". */
  reject?: string | boolean;
  /** Show the pending plan + approval state, don't mutate. */
  show?: boolean;
}

export async function approveCmd(
  projectName: string,
  feature: string,
  opts: ApproveOpts = {},
): Promise<void> {
  if (opts.show) {
    const state = getApproval(projectName, feature);
    const status = approvalStatus(state);
    const todo = getTodo(projectName, feature);
    logger.info(``);
    logger.info(`── ${projectName}/${feature} — approval status: ${status} ──`);
    if (state) {
      if (state.planSubmittedAt) logger.info(`  plan submitted: ${state.planSubmittedAt}`);
      if (state.approvedAt) logger.info(`  approved at:    ${state.approvedAt}`);
      if (state.rejectionNote) logger.info(`  rejection note: ${state.rejectionNote}`);
    } else {
      logger.info(`  no approval state (the agent may not be in --review-plan mode)`);
    }
    if (todo) {
      const done = todo.items.filter((it) => it.done).length;
      logger.info(``);
      logger.info(`  TODO (${done}/${todo.items.length}):`);
      for (const it of todo.items) {
        const mark = it.done ? "[x]" : "[ ]";
        logger.info(`    ${mark} ${it.id}. ${it.text}`);
      }
    } else {
      logger.info(`  no TODO list set yet`);
    }
    return;
  }

  if (opts.reject !== undefined && opts.reject !== false) {
    const note = typeof opts.reject === "string" ? opts.reject : undefined;
    const state = rejectPlan(projectName, feature, note);
    logger.ok(
      `plan rejected for ${projectName}/${feature}${note ? `: ${note}` : ""}`,
    );
    logger.info(`agent will be told to revise on its next turn (state: ${approvalStatus(state)})`);
    return;
  }

  // approve
  const before = getApproval(projectName, feature);
  if (!before || !before.planSubmittedAt) {
    throw new UsageError(
      `no plan has been submitted for ${projectName}/${feature}. ` +
        `the agent must call banyan_request_plan_approval before you can approve.`,
    );
  }
  const state = approvePlan(projectName, feature);
  logger.ok(`plan approved for ${projectName}/${feature} (at ${state.approvedAt})`);
  logger.info(`agent will start working on its next turn`);
}
