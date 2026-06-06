/**
 * End-of-task reports — the agent submits one when it considers the work
 * done, blocked, or needing review. The orchestrator lists them, then
 * approves/rejects. Approval is conceptually distinct from plan-approval
 * (different state file, different lifecycle moment) so report and
 * approval tools live in separate files.
 */
import * as api from "../api.js";
import type { ToolDef } from "./types.js";

export const reportTools: ToolDef[] = [
  {
    spec: {
      name: "banyan_report_done",
      description:
        "Submit an end-of-task report for a feature. Call this when you (the per-feature agent) believe you have completed, blocked on, or want a human review of the assigned task. The report is appended to the project's timeline (~/.config/banyan/state/<project>.reports.jsonl) and surfaced to the orchestrator and the user. Be honest about hesitations — that's what saves a review from missing edge cases.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          status: {
            type: "string",
            enum: ["done", "blocked", "needs_review"],
            description:
              "done: task is complete from your point of view. blocked: you cannot proceed (state why in summary + openQuestions). needs_review: you produced a result but want human judgment before merge.",
          },
          summary: {
            type: "string",
            description: "1-3 sentences: what was done, in plain language. The headline the user will scan first.",
          },
          testInstructions: {
            type: "string",
            description: "How to manually verify this task. Concrete steps a human can follow before approving merge.",
          },
          hesitations: {
            type: "array",
            items: { type: "string" },
            description: "Decisions you were uncertain about. Each item is one hesitation. This is the most valuable optional field — never omit a real hesitation.",
          },
          openQuestions: {
            type: "array",
            items: { type: "string" },
            description: "Questions you deliberately deferred or want answered before the work is fully done.",
          },
          risks: {
            type: "array",
            items: { type: "string" },
            description: "Potential side effects, fragile zones, things to watch in production.",
          },
          filesChanged: {
            type: "array",
            items: { type: "string" },
            description: "Optional: list of files touched (relative paths). Useful in the timeline view; can be derived from git diff.",
          },
          commits: {
            type: "array",
            items: {
              type: "object",
              properties: {
                sha: { type: "string" },
                message: { type: "string" },
              },
              required: ["sha", "message"],
              additionalProperties: false,
            },
            description: "Optional: commits produced for this task.",
          },
        },
        required: ["project", "feature", "status", "summary", "testInstructions"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.reportDone(args.project, args.feature, {
        status: args.status,
        summary: args.summary,
        testInstructions: args.testInstructions,
        hesitations: args.hesitations,
        openQuestions: args.openQuestions,
        risks: args.risks,
        filesChanged: args.filesChanged,
        commits: args.commits,
      }),
    scopes: ["feature"],
  },
  {
    spec: {
      name: "banyan_list_reports",
      description:
        "Read end-of-task reports submitted by per-feature agents for a project. The orchestrator polls this to know which features have signaled completion. Reports are returned in submission order (oldest first). Use `latestOnly` to collapse to one per feature for a status overview.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: {
            type: "string",
            description: "filter to a single feature (optional)",
          },
          since: {
            type: "string",
            description: "ISO 8601 timestamp — only return reports submitted at-or-after this time (optional)",
          },
          latestOnly: {
            type: "boolean",
            description: "collapse to one report per feature (the latest), keeping submission order. Useful for a status overview.",
          },
        },
        required: ["project"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.listReports(args.project, {
        feature: args.feature,
        since: args.since,
        latestOnly: args.latestOnly,
      }),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_approve_report",
      description:
        "Approve the latest end-of-task report submitted for a feature. Signals that the user (or orchestrator on the user's behalf) has reviewed the report and is satisfied — typically the next step is `bn merge <feature>`. Errors if no report has been submitted.",
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
    handler: async (args: any) =>
      api.approveFeatureReport(args.project, args.feature),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_reject_report",
      description:
        "Reject the latest end-of-task report. Use when the report is incomplete or the work needs more iteration. The agent should pick up the rejection note via a follow-up task (e.g. `banyan_assign_task` with the rejection content) — banyan does not auto-feed the note back to the agent.",
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
    handler: async (args: any) =>
      api.rejectFeatureReport(args.project, args.feature, args.note),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_get_report_approval",
      description:
        "Read the current report-approval state for a feature. Returns one of: no-report-yet, pending, approved, rejected. Use this to know if there's a report awaiting review or already decided on.",
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
    handler: async (args: any) =>
      api.getFeatureReportApproval(args.project, args.feature),
    scopes: ["orchestrator"],
  },
];
