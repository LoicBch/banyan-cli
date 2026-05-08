import type { Context } from "../context.js";
import * as tmux from "../tmux.js";
import * as git from "../git.js";
import * as naming from "../naming.js";
import { readAgentState } from "../agentState.js";
import { readReports } from "../reports.js";
import { approvalStatus, getApproval } from "../approval.js";

interface FeatureStatus {
  name: string;
  mode: string;          // e.g. "autonomous + plan-review", or "?" if no agent state
  agentState: "live" | "idle" | "missing";
  stackRunning: boolean;
  reportStatus: string | "—"; // latest report status if any
  approvalStatus: string;     // pending / approved / rejected / no-plan-yet
}

export async function status(ctx: Context): Promise<void> {
  const sessionName = ctx.naming.session;
  const sessionRunning = await tmux.hasSession(sessionName);

  // Header
  ctx.logger.info(
    `session '${sessionName}': ${sessionRunning ? "running" : "stopped"}`,
  );

  // Discover features from worktrees on disk (independent of session state).
  const features = new Set<string>();
  for (const repo of ctx.project.repos) {
    if (repo.type === "compose") continue;
    const wts = await git.worktreeList(repo.path).catch(() => []);
    for (const wt of wts) {
      if (wt.path === repo.path) continue;
      const parsed = naming.parseWorktreePath(wt.path, repo.path);
      if (parsed) features.add(parsed.feature);
    }
  }

  if (features.size === 0) {
    ctx.logger.info(``);
    ctx.logger.info(`no active features`);
    if (!sessionRunning) {
      ctx.logger.info(``);
      ctx.logger.info(`start with: bn ${ctx.project.name} start`);
    }
    return;
  }

  // Gather per-feature status
  const agentsWin = naming.agentsWindowName(ctx.project.name);
  const statuses: FeatureStatus[] = [];
  for (const feature of [...features].sort()) {
    const agentSt = readAgentState(ctx.project.name, feature);
    const mode = agentSt
      ? `${agentSt.mode}${agentSt.requireApproval ? " + plan-review" : ""}`
      : "?";

    let agentState: FeatureStatus["agentState"] = "missing";
    let stackRunning = false;

    if (sessionRunning) {
      // Agent pane lookup
      const paneId =
        (await tmux
          .findPaneByUserOption(sessionName, agentsWin, "@banyan-pane", feature)
          .catch(() => undefined)) ?? undefined;
      if (paneId) {
        const claudeUp = await tmux.isClaudeRunning(paneId).catch(() => false);
        agentState = claudeUp ? "live" : "idle";
      }

      // Stack window lookup
      const stackWin = `test-${feature}`;
      stackRunning = await tmux.windowExists(sessionName, stackWin).catch(() => false);
    }

    const latestReport = readReports(ctx.project.name, { feature, latestOnly: true })[0];
    const reportStatus = latestReport ? latestReport.status : "—";
    const approval = approvalStatus(getApproval(ctx.project.name, feature));

    statuses.push({
      name: feature,
      mode,
      agentState,
      stackRunning,
      reportStatus,
      approvalStatus: approval,
    });
  }

  // Render features table
  ctx.logger.info(``);
  ctx.logger.info(`features:`);
  const nameWidth = Math.max(7, ...statuses.map((s) => s.name.length));
  const modeWidth = Math.max(4, ...statuses.map((s) => s.mode.length));
  for (const s of statuses) {
    const agentLabel =
      s.agentState === "live" ? "agent: live"
      : s.agentState === "idle" ? "agent: idle"
      : sessionRunning ? "agent: gone"
      : "agent: -";
    const stackLabel = s.stackRunning
      ? "stack: running"
      : sessionRunning ? "stack: stopped" : "stack: -";
    const reportLabel = s.reportStatus !== "—" ? `report: ${s.reportStatus}` : "";
    const approvalLabel =
      s.approvalStatus === "pending" ? " plan: pending"
      : s.approvalStatus === "rejected" ? " plan: rejected"
      : "";
    ctx.logger.info(
      `  ${s.name.padEnd(nameWidth)}  ${s.mode.padEnd(modeWidth)}  ${agentLabel.padEnd(13)}  ${stackLabel.padEnd(20)}  ${reportLabel}${approvalLabel}`,
    );
  }

  // Tmux windows (compact, secondary)
  if (sessionRunning) {
    const wins = await tmux.listWindows(sessionName);
    ctx.logger.info(``);
    ctx.logger.info(`windows:`);
    for (const w of wins) {
      const marker = w.active ? "*" : " ";
      ctx.logger.info(`  ${marker} ${w.name}`);
    }
  } else {
    ctx.logger.info(``);
    ctx.logger.info(`start with: bn ${ctx.project.name} start`);
  }
}
