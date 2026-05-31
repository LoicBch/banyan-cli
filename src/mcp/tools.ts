/**
 * MCP tool registry: every banyan operation exposed to MCP clients
 * (Claude Code, Cursor, etc.) is declared here. The shape is `{ spec,
 * handler, scopes? }` so the server can both list specs, dispatch calls,
 * AND filter the toolset by scope at boot time — keeps per-feature agents
 * and headless resolvers from paying 21k tokens of orchestrator-only
 * tools they'd never call.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import * as api from "./api.js";

/** Which class of caller is this tool meant for. A tool with no `scopes`
 *  field is treated as `all` (backward-compat / power use). */
export type ToolScope = "feature" | "resolver" | "orchestrator";

export interface ToolDef<T = Record<string, unknown>> {
  spec: Tool;
  handler: (args: T) => Promise<unknown>;
  /** Which scopes get this tool exposed. Omitted = available in every scope. */
  scopes?: readonly ToolScope[];
}

export const tools: ToolDef[] = [
  {
    spec: {
      name: "banyan_list_projects",
      description: "List all banyan projects configured in ~/.config/banyan/config.yaml.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    handler: async () => api.listProjects(),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_project_info",
      description:
        "Get full configuration for a project: repos (git or compose), run commands, base branches, env templates, composePorts.",
      inputSchema: {
        type: "object",
        properties: { project: { type: "string" } },
        required: ["project"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.projectInfo(args.project),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_list_features",
      description:
        "List active features for a project, including each repo's worktree path and branch. Discovered by scanning git worktrees.",
      inputSchema: {
        type: "object",
        properties: { project: { type: "string" } },
        required: ["project"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.listFeatures(args.project),
    scopes: ["orchestrator", "resolver"],
  },
  {
    spec: {
      name: "banyan_feature_status",
      description:
        "Per-repo status of a feature: worktree existence, branch, HEAD commit, dirty flag, commits ahead of base.",
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
    handler: async (args: any) => api.featureStatus(args.project, args.feature),
    scopes: ["orchestrator", "resolver"],
  },
  {
    spec: {
      name: "banyan_list_stacks",
      description: "List active docker-compose stacks for the project (one per feature using infra).",
      inputSchema: {
        type: "object",
        properties: { project: { type: "string" } },
        required: ["project"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.listStacks(args.project),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_get_stack_ports",
      description:
        "Get host ports allocated by docker for a feature's compose stack. Returns service/containerPort/hostPort triples.",
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
    handler: async (args: any) => api.getStackPorts(args.project, args.feature),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_stack_logs",
      description: "Tail logs from the feature's compose stack. Optionally filter by service.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          service: { type: "string", description: "compose service name (optional)" },
          tail: { type: "number", description: "number of lines (default 100)" },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.stackLogs(args.project, args.feature, args.service, args.tail ?? 100),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_create_feature",
      description:
        "Create worktrees + start compose stacks + launch a Claude pane for a new feature. Optionally restrict to specific repos. If `initialPrompt` is given, the per-feature Claude agent starts with that prompt as its first message (only on a fresh session — ignored if a prior conversation is being resumed).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          repos: {
            type: "array",
            items: { type: "string" },
            description: "optional subset of repo names; default: all configured repos",
          },
          initialPrompt: {
            type: "string",
            description:
              "first message sent to the per-feature Claude agent (e.g. the task description). Use this to dispatch a task at creation time without a follow-up call.",
          },
          prefix: {
            type: "string",
            description:
              "branch prefix instead of the default 'feature' (e.g. 'fix' → fix/<feature>). Pass empty string for no prefix.",
          },
          mode: {
            type: "string",
            enum: ["interactive", "assisted", "autonomous", "autopilot"],
            description:
              "agent autonomy level. interactive: plain claude, no convention. assisted: agent decides minor things, asks on big decisions. autonomous (default for MCP-driven creation): agent decides everything, documents hesitations in the report. autopilot: autonomous + works through a TODO list, loops until banyan_report_done is called.",
          },
          requireApproval: {
            type: "boolean",
            description:
              "if true, gate the agent: it must build a TODO list and call `banyan_request_plan_approval`, then wait for user approval (`banyan_approve_plan` or `bn approve`) before working. Orthogonal to mode — combine with autonomous or autopilot. Use when the user wants to validate the plan before execution. Ignored for mode=interactive.",
          },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.createFeature(
        args.project,
        args.feature,
        args.repos,
        args.initialPrompt,
        args.prefix,
        args.mode,
        args.requireApproval,
      ),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_assign_task",
      description:
        "Send a prompt to the Claude agent of an existing feature (paste-and-submit into the feature pane). Use this to dispatch follow-up tasks after `banyan_create_feature`, or to assign work to features that were created without an `initialPrompt`. The feature pane must exist and Claude must be running in it (unless `force` is true).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          prompt: {
            type: "string",
            description: "the message to send to the per-feature agent",
          },
          force: {
            type: "boolean",
            description:
              "send even if Claude isn't detected as running in the pane (default: false). Use only when you know the pane is ready.",
          },
        },
        required: ["project", "feature", "prompt"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.assignTask(args.project, args.feature, args.prompt, { force: args.force }),
    scopes: ["orchestrator"],
  },
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
      name: "banyan_set_todo",
      description:
        "Replace the TODO list for a feature with a fresh set of items. Use this at the start of a task to lay out your plan in concrete steps. Each string becomes one TODO item with auto-assigned id (1..N). Resets any prior list.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          items: {
            type: "array",
            items: { type: "string" },
            description: "Ordered list of TODO items, one short sentence each.",
          },
        },
        required: ["project", "feature", "items"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.setFeatureTodo(args.project, args.feature, args.items),
    scopes: ["feature"],
  },
  {
    spec: {
      name: "banyan_get_todo",
      description:
        "Read the current TODO list for a feature. Returns null if no list has been set yet.",
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
    handler: async (args: any) => api.getFeatureTodo(args.project, args.feature),
    scopes: ["feature"],
  },
  {
    spec: {
      name: "banyan_update_todo",
      description:
        "Fine-grained edits to a feature's TODO list. Combine any of the four ops in a single call. Items are referenced by their string id (returned by `banyan_set_todo` / `banyan_get_todo`). New items added via `add` get fresh ids — IDs are never reused.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          add: {
            type: "array",
            items: { type: "string" },
            description: "append these items to the list",
          },
          done: {
            type: "array",
            items: { type: "string" },
            description: "mark these item ids as done",
          },
          undone: {
            type: "array",
            items: { type: "string" },
            description: "mark these item ids as not done (revert)",
          },
          remove: {
            type: "array",
            items: { type: "string" },
            description: "delete these item ids from the list",
          },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.updateFeatureTodo(args.project, args.feature, {
        add: args.add,
        done: args.done,
        undone: args.undone,
        remove: args.remove,
      }),
    scopes: ["feature"],
  },
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
  {
    spec: {
      name: "banyan_remove_feature",
      description:
        "Remove worktrees of a feature (keeps branches local AND remote, keeps stack volumes). Light teardown — use this when you want to drop the working dir but keep the branch around (not ready to merge yet, want to revisit later, etc.).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          repo: { type: "string", description: "single repo (optional; default: all)" },
          force: {
            type: "boolean",
            description: "remove the worktree even if it has uncommitted/untracked changes (the branch is still kept)",
          },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.removeFeature(args.project, args.feature, args.repo, args.force),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_cleanup_feature",
      description:
        "Full teardown of a feature: remove worktrees, delete branches (safe), drop compose volumes, close panes.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          repo: { type: "string" },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.cleanupFeature(args.project, args.feature, args.repo),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_start_test",
      description:
        "Start the dev processes for a feature (front + back + ...) with dynamic port allocation and env injection. Auto-starts compose stacks if needed.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          repos: { type: "array", items: { type: "string" } },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.startTest(args.project, args.feature, args.repos),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_stop_test",
      description:
        "Stop the dev processes for a feature: kill the test tmux window and run each repo's run.stopCommand.",
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
    handler: async (args: any) => api.stopTest(args.project, args.feature),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_stack_up",
      description: "Start (or no-op if running) the docker compose stacks for a feature.",
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
    handler: async (args: any) => api.stackUp(args.project, args.feature),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_stack_down",
      description: "Stop the docker compose stacks for a feature (volumes preserved).",
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
    handler: async (args: any) => api.stackDown(args.project, args.feature),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_stack_recreate",
      description:
        "Wipe a feature's compose volumes + bring stacks back up (re-imports any docker-entrypoint-initdb.d seed).",
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
    handler: async (args: any) => api.stackRecreate(args.project, args.feature),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_rebase_feature",
      description:
        "Rebase the feature branch on origin/<base> for one or all repos. Errors if conflicts (use banyan_merge_feature for auto-resolve).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          repo: { type: "string" },
          base: { type: "string", description: "override base branch (default: repo baseBranch)" },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.rebaseFeature(args.project, args.feature, args.repo, args.base),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_merge_feature",
      description:
        "Push + create MR/PR + merge for one or all repos of the feature. Any uncommitted changes in the worktree are auto-committed first (message: 'auto-commit: <feature> before merge') and pushed as part of the MR — dirty worktrees do NOT cause data loss, so don't refuse to merge on that basis. Pre-flight rebase always runs; conflicts are auto-resolved by a headless Claude resolver (set noResolve=true to opt out and pause for manual fix). After a successful PR/MR merge the local <base> branch is fast-forwarded to origin/<base>. The merge strategy comes from the repo's `mergeStrategy` config field (default 'squash').",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          repo: { type: "string" },
          noResolve: {
            type: "boolean",
            description: "opt out of the headless conflict resolver (default: resolver runs)",
          },
          local: { type: "boolean", description: "skip MR flow, merge locally" },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.mergeFeature(args.project, args.feature, args.repo, {
        noResolve: args.noResolve,
        local: args.local,
      }),
    scopes: ["orchestrator"],
  },
  {
    spec: {
      name: "banyan_finalize_feature_name",
      description:
        "Promote a DRAFT worktree to a real feature name. You MUST call this exactly once after the user gives you their first instruction, with a short kebab-case slug describing the task (e.g. 'login-flow', 'crash-on-close', 'export-pdf-tweaks'). " +
        "While the worktree is in draft state, every other banyan tool is blocked — this is the only way out. " +
        "Banyan renames the git branch in every repo of the feature, re-tags the tmux pane, and migrates internal state. The on-disk path keeps its draft slug (cosmetic only — branch/MR/test all use the new name). " +
        "Picks the name based on the user's request: be concise, descriptive, lowercase, hyphens between words, ≤30 chars. Avoid generic names like 'fix' or 'update'. Refuse to invent a name if the user's instruction is ambiguous — ask them for one short phrase summarising the task first.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              "kebab-case feature slug (lowercase letters, digits, '.', '_', '-'; must start with a letter or digit; cannot start with 'draft-')",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.finalizeFeatureName(args.name),
    scopes: ["feature"],
  },
];
