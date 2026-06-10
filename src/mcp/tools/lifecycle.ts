/**
 * Feature + stack lifecycle: create, remove, cleanup, start/stop test
 * processes, stack up/down/recreate, rebase, merge, finalize the draft
 * feature name. State-mutating, mostly orchestrator-scoped.
 */
import * as api from "../api.js";
import type { ToolDef } from "./types.js";

export const lifecycleTools: ToolDef[] = [
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
            enum: ["live", "delegated"],
            description:
              "agent autonomy level. live: banyan-aware claude in a normal collaborative session — no report obligation, user is at the terminal. delegated (default for MCP-driven creation): pipeline-gated — agent submits a plan for review, executes the approved TODO list, submits a final report, looped via Stop hook until banyan_report_done is called.",
          },
          requireApproval: {
            type: "boolean",
            description:
              "Legacy flag — `delegated` mode already bakes in plan-review. Set this only to opt-into plan-review explicitly from `live` mode (rare).",
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
