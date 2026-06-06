/**
 * MCP tool registry — aggregator.
 *
 * Every banyan operation exposed to MCP clients (Claude Code, Cursor, etc.)
 * is declared in one of the per-category files under tools/. This file
 * concatenates them and re-exports the public types so existing imports
 * (`from "./tools.js"`) keep working unchanged.
 *
 * Categories:
 *   tools/types.ts        — ToolDef + ToolScope (leaf module, zero deps)
 *   tools/discovery.ts    — read-only inspection (list, status, logs)
 *   tools/lifecycle.ts    — create, remove, cleanup, start, stop, rebase, merge
 *   tools/todo.ts         — per-feature TODO list ops
 *   tools/approval.ts     — plan approval gate (request, approve, reject, get)
 *   tools/report.ts       — end-of-task report submission + approval
 *   tools/task.ts         — orchestrator-to-agent task dispatch
 *
 * Add a new tool by appending it to the category that fits, or create a
 * new file and spread it into `tools` below.
 */
export type { ToolDef, ToolScope } from "./tools/types.js";

import { discoveryTools } from "./tools/discovery.js";
import { lifecycleTools } from "./tools/lifecycle.js";
import { todoTools } from "./tools/todo.js";
import { approvalTools } from "./tools/approval.js";
import { reportTools } from "./tools/report.js";
import { taskTools } from "./tools/task.js";
import type { ToolDef } from "./tools/types.js";

export const tools: ToolDef[] = [
  ...discoveryTools,
  ...lifecycleTools,
  ...taskTools,
  ...reportTools,
  ...todoTools,
  ...approvalTools,
];
