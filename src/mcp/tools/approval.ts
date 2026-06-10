/**
 * Plan-approval gate tools. The feature agent requests approval after
 * laying out its TODO list; the orchestrator (or user) approves/rejects.
 * Report approval lives in tools/report.ts since reports come from the
 * agent and are decided on by the orchestrator — same shape but tied to
 * the end-of-task moment, not the planning moment.
 */
import * as api from "../api.js";
import type { ToolDef } from "./types.js";

export const approvalTools: ToolDef[] = [
  {
    spec: {
      name: "banyan_request_plan_approval",
      description:
        "Signal that you (the per-feature agent) have finished planning and are ready for user review. Call this AFTER you've set up the TODO list with `banyan_set_todo`, when the feature was created with `requireApproval: true`. The supervisor will then block any further work until the user approves the plan via `banyan_approve_plan` (or `bn <project> approve <feature>`). Calling this again invalidates any prior approval and forces re-review — useful if you've revised the plan based on rejection feedback.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.requestPlanApproval(args.project, args.feature),
    scopes: ["feature"],
  },
  {
    spec: {
      name: "banyan_approve_plan",
      description:
        "Approve the latest submitted plan for a feature. Releases the agent to start working through its TODO list. Used by the orchestrator (or directly by the user) when they've reviewed the plan and are happy with it.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.approveFeaturePlan(args.project, args.feature),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_reject_plan",
      description:
        "Reject the latest submitted plan for a feature, with an optional explanation. The supervisor will inject the rejection note into the agent's next turn so it can revise. Use this when the plan misses requirements, picks the wrong approach, or needs scope changes.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          note: {
            type: "string",
            description: "explanation for the rejection — what should change",
          },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.rejectFeaturePlan(args.project, args.feature, args.note),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_get_plan_approval",
      description:
        "Read the current plan-approval state for a feature. Returns one of: no-plan-yet, pending, approved, rejected. Use this to know whether you (orchestrator or agent) need to wait, approve, or revise.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.getFeatureApproval(args.project, args.feature),
    scopes: ["orchestrator"],
  },
];
