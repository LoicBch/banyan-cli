/**
 * MCP tool registry: every banyan operation exposed to MCP clients
 * (Claude Code, Cursor, etc.) is declared here. The shape is `{ spec,
 * handler }` so the server can both list specs and dispatch calls.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import * as api from "./api.js";

export interface ToolDef<T = Record<string, unknown>> {
  spec: Tool;
  handler: (args: T) => Promise<unknown>;
}

export const tools: ToolDef[] = [
  {
    spec: {
      name: "banyan_list_projects",
      description: "List all banyan projects configured in ~/.config/banyan/config.yaml.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    handler: async () => api.listProjects(),
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
      ),
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
  },
  {
    spec: {
      name: "banyan_merge_feature",
      description:
        "Push + create MR/PR + merge for one or all repos of the feature. Pre-flight rebase happens locally; conflicts are auto-resolved by spawning a headless Claude resolver (--auto-resolve true by default in MCP).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          repo: { type: "string" },
          autoResolve: { type: "boolean", description: "default true in MCP" },
          strategy: { type: "string", enum: ["squash", "merge", "rebase"] },
          local: { type: "boolean", description: "skip MR flow, merge locally" },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.mergeFeature(args.project, args.feature, args.repo, {
        autoResolve: args.autoResolve,
        strategy: args.strategy,
        local: args.local,
      }),
  },
];
