/**
 * Per-feature agent state — how the agent was launched, so `bn resume` can
 * recreate it with the same options. Without this, resume defaults every
 * agent to mode=interactive, silently downgrading autopilot/autonomous
 * features to plain claude (lost system prompt, lost Stop hook).
 *
 * Layout: ~/.config/banyan/state/<project>.<feature>.agent.json
 *
 * Written by `wtAll` at agent launch.
 * Read by `resume` to restore the same options.
 * Deleted by `cleanup` alongside the rest of the per-feature state.
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
import type { AgentMode } from "./agentPrompt.js";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");

export interface AgentState {
  project: string;
  feature: string;
  mode: AgentMode;
  /** True if the agent was launched with --review-plan / requireApproval. */
  requireApproval?: boolean;
  createdAt: string;
  updatedAt: string;
}

function agentStatePath(project: string, feature: string): string {
  return path.join(STATE_DIR, `${project}.${feature}.agent.json`);
}

export function writeAgentState(args: {
  project: string;
  feature: string;
  mode: AgentMode;
  requireApproval?: boolean;
}): AgentState {
  mkdirSync(STATE_DIR, { recursive: true });
  const existing = readAgentState(args.project, args.feature);
  const now = new Date().toISOString();
  const next: AgentState = {
    project: args.project,
    feature: args.feature,
    mode: args.mode,
    ...(args.requireApproval ? { requireApproval: true } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  writeFileSync(agentStatePath(args.project, args.feature), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function readAgentState(project: string, feature: string): AgentState | undefined {
  const p = agentStatePath(project, feature);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as AgentState;
  } catch {
    return undefined;
  }
}

export function deleteAgentState(project: string, feature: string): void {
  const p = agentStatePath(project, feature);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}
