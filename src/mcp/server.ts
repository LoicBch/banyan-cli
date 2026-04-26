/**
 * Banyan MCP server (stdio transport).
 *
 * Exposes banyan operations as Model Context Protocol tools so an agent
 * (Claude Code, Cursor, anything MCP-aware) can drive worktree creation,
 * tests, merges, and infra in a structured, scriptable way.
 *
 * Usage from the user's MCP client config:
 *   {
 *     "mcpServers": {
 *       "banyan": { "command": "banyan", "args": ["mcp-serve"] }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as api from "./api.js";

// --- Tool-call audit log ---------------------------------------------------
// Every CallTool handled by this server is appended to a shared file. Lets
// the user (or another agent) see what banyan tools the orchestrator actually
// invokes via `bn mcp-log` (tail) without parsing claude's session.
export const MCP_LOG_PATH = path.join(homedir(), ".config", "banyan", "mcp-calls.log");

function logToolCall(entry: {
  tool: string;
  args: unknown;
  status: "ok" | "error";
  durationMs: number;
  errorMsg?: string;
}): void {
  try {
    mkdirSync(path.dirname(MCP_LOG_PATH), { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      ...entry,
    });
    appendFileSync(MCP_LOG_PATH, line + "\n", "utf8");
  } catch {
    // never let logging break the request
  }
}

interface ToolDef<T = Record<string, unknown>> {
  spec: Tool;
  handler: (args: T) => Promise<unknown>;
}

// --- Tool registry ---------------------------------------------------------

const tools: ToolDef[] = [
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
        "Create worktrees + start compose stacks + launch a Claude pane for a new feature. Optionally restrict to specific repos.",
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
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.createFeature(args.project, args.feature, args.repos),
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

// --- Server boot -----------------------------------------------------------

export async function runMcpServer(): Promise<void> {
  // Quiet stdout so logger output goes to stderr, leaving stdout clean for
  // the JSON-RPC framing.
  process.env.BANYAN_STDIO_QUIET = "1";

  const server = new Server(
    { name: "banyan", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => t.spec),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const tool = tools.find((t) => t.spec.name === name);
    const start = Date.now();
    if (!tool) {
      logToolCall({
        tool: name,
        args,
        status: "error",
        durationMs: 0,
        errorMsg: "unknown tool",
      });
      return {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${name}` }],
      };
    }
    try {
      const result = await tool.handler(args);
      logToolCall({
        tool: name,
        args,
        status: "ok",
        durationMs: Date.now() - start,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logToolCall({
        tool: name,
        args,
        status: "error",
        durationMs: Date.now() - start,
        errorMsg: msg,
      });
      return {
        isError: true,
        content: [{ type: "text", text: msg }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive until stdin closes (MCP convention) or SIGTERM.
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
}
