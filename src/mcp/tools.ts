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
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.createFeature(args.project, args.feature, args.repos, args.initialPrompt, args.prefix),
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
      name: "banyan_remove_feature",
      description: "Remove worktrees of a feature (keeps branches and stack volumes). Light teardown.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          repo: { type: "string", description: "single repo (optional; default: all)" },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.removeFeature(args.project, args.feature, args.repo),
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
