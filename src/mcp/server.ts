/**
 * Banyan MCP server (stdio transport).
 *
 * Exposes banyan operations as Model Context Protocol tools so an agent
 * (Claude Code, Cursor, anything MCP-aware) can drive worktree creation,
 * tests, merges, and infra in a structured, scriptable way.
 *
 * Implementation is split across:
 *   - tools.ts — registry of MCP tool specs + handlers
 *   - log.ts   — audit log + CLI-equivalent translation
 *   - api.ts   — banyan operations (used by both MCP and dashboard)
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
} from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { tools, type ToolScope } from "./tools.js";
import { logToolCall } from "./log.js";
import { isDraftFeature } from "../naming.js";

/**
 * Filter the registered tool list down to those exposed for `scope`. A tool
 * with no `scopes` field is treated as global (every scope). When `scope` is
 * undefined the full toolset is exposed (orchestrator default).
 */
function toolsForScope(scope: ToolScope | undefined) {
  if (!scope) return tools;
  return tools.filter((t) => !t.scopes || t.scopes.includes(scope));
}

function parseScopeArg(): ToolScope | undefined {
  const i = process.argv.indexOf("--scope");
  if (i < 0 || i + 1 >= process.argv.length) return undefined;
  const v = process.argv[i + 1];
  if (v === "feature" || v === "resolver" || v === "orchestrator") return v;
  return undefined;
}

/**
 * Detect if the MCP server is running on behalf of an agent in a *draft*
 * worktree. The MCP transport doesn't carry the caller's cwd, but the MCP
 * server is spawned as a subprocess of the agent (per the user's MCP config)
 * — so `process.cwd()` matches the agent's launch cwd. We look for the
 * `worktree-<repo>/draft-<ts>` segment in that path.
 */
function detectDraftFeature(): string | undefined {
  const cwd = process.cwd();
  const parts = cwd.split(path.sep);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i]!.startsWith("worktree-")) {
      const feature = parts[i + 1];
      if (feature && isDraftFeature(feature)) return feature;
      return undefined;
    }
  }
  return undefined;
}

/** Tools that are exempt from the draft guard. Keep tight — anything that
 *  actually modifies branches / files / state should NOT be exempt. */
const DRAFT_ALLOWED_TOOLS = new Set([
  "banyan_finalize_feature_name",
]);

export { MCP_LOG_PATH } from "./log.js";

export async function runMcpServer(): Promise<void> {
  // Quiet stdout so logger output goes to stderr, leaving stdout clean for
  // the JSON-RPC framing.
  process.env.BANYAN_STDIO_QUIET = "1";

  // Scope filtering: only expose tools relevant to the caller class. Cuts
  // per-feature agents from 31 tools down to 6, saving ~17k tokens on each
  // model turn.
  const scope = parseScopeArg();
  const exposedTools = toolsForScope(scope);

  const server = new Server(
    { name: "banyan", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: exposedTools.map((t) => t.spec),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const tool = exposedTools.find((t) => t.spec.name === name);
    const start = Date.now();

    // Draft guard rail — see detectDraftFeature(). An agent in a draft
    // worktree must finalize its feature name before doing anything else.
    const draft = detectDraftFeature();
    if (draft && !DRAFT_ALLOWED_TOOLS.has(name)) {
      const msg =
        `This worktree is still a draft (feature: ${draft}). ` +
        `Call banyan_finalize_feature_name({ name: "<kebab-case>" }) first with a short ` +
        `slug describing the user's task, then retry. ` +
        `Allowed tools in draft state: ${[...DRAFT_ALLOWED_TOOLS].join(", ")}.`;
      logToolCall({
        tool: name,
        args,
        status: "error",
        durationMs: 0,
        errorMsg: "blocked by draft guard",
      });
      return {
        isError: true,
        content: [{ type: "text", text: msg }],
      };
    }

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
