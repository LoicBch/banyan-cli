/**
 * Read-only inspection tools. Safe to expose to any client that just wants
 * to ask "what's there?" — listing projects, repos, features, stacks, ports,
 * logs. No state mutation.
 */
import * as api from "../api.js";
import type { ToolDef } from "./types.js";

export const discoveryTools: ToolDef[] = [
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
];
