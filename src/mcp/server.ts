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
import { tools } from "./tools.js";
import { logToolCall } from "./log.js";

export { MCP_LOG_PATH } from "./log.js";

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
