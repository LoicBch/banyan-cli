/**
 * Public façade for the MCP API surface.
 *
 * Every banyan operation exposed to MCP clients (via mcp/tools.ts) is
 * declared in one of the per-category modules under api/. This file
 * re-exports them so existing imports (`from "./api.js"`) keep working —
 * mcp/tools/<category>.ts files all do `import * as api from "../api.js"`
 * which now resolves to this façade.
 *
 * Layout (post-split):
 *   src/mcp/api/
 *     shared.ts        — getConfig + validateProject helpers
 *     discovery.ts     — read-only inspection (7 fns)
 *     lifecycle.ts     — create/remove/cleanup/start/stop/stack/rebase/
 *                         merge/finalize (11 fns + 2 migrate helpers)
 *     task.ts          — orchestrator → agent dispatch (1 fn)
 *     todo.ts          — per-feature TODO list ops (3 fns)
 *     approval.ts      — plan-approval gate (4 fns)
 *     report.ts        — end-of-task report + approval (5 fns)
 */
export {
  listProjects,
  projectInfo,
  listFeatures,
  featureStatus,
  listStacks,
  getStackPorts,
  stackLogs,
} from "./api/discovery.js";

export {
  createFeature,
  removeFeature,
  cleanupFeature,
  startTest,
  stopTest,
  stackUp,
  stackDown,
  stackRecreate,
  rebaseFeature,
  mergeFeature,
  finalizeFeatureName,
} from "./api/lifecycle.js";

export { assignTask } from "./api/task.js";

export {
  setFeatureTodo,
  getFeatureTodo,
  updateFeatureTodo,
} from "./api/todo.js";

export {
  requestPlanApproval,
  approveFeaturePlan,
  rejectFeaturePlan,
  getFeatureApproval,
} from "./api/approval.js";

export {
  reportDone,
  listReports,
  approveFeatureReport,
  rejectFeatureReport,
  getFeatureReportApproval,
} from "./api/report.js";
