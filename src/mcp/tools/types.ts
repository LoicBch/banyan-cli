/**
 * Shared types for the MCP tool registry — kept in a leaf module so each
 * tool category (discovery, lifecycle, todo, approval, report, task) can
 * import them without going through the aggregator and risking a cycle.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/** Which class of caller is this tool meant for. A tool with no `scopes`
 *  field is treated as `all` (backward-compat / power use). */
export type ToolScope = "feature" | "resolver" | "orchestrator";

export interface ToolDef<T = Record<string, unknown>> {
  spec: Tool;
  handler: (args: T) => Promise<unknown>;
  /** Which scopes get this tool exposed. Omitted = available in every scope. */
  scopes?: readonly ToolScope[];
}
