/**
 * Audit log for banyan MCP tool calls.
 *
 * Every CallTool handled by the server is appended to a shared file. Lets
 * the user (or another agent) see what banyan tools the orchestrator
 * actually invokes via `bn mcp-log` (tail) without parsing claude's
 * session.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const MCP_LOG_PATH = path.join(homedir(), ".config", "banyan", "mcp-calls.log");

export interface LogEntry {
  tool: string;
  args: unknown;
  status: "ok" | "error";
  durationMs: number;
  errorMsg?: string;
}

export function logToolCall(entry: LogEntry): void {
  try {
    mkdirSync(path.dirname(MCP_LOG_PATH), { recursive: true });
    const cliEquivalent = mcpToolToCli(entry.tool, entry.args);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      ...entry,
      cli: cliEquivalent,
    });
    appendFileSync(MCP_LOG_PATH, line + "\n", "utf8");
  } catch {
    // never let logging break the request
  }
}

/**
 * Translate an MCP tool invocation to the equivalent `bn` CLI command —
 * both for the audit log and so the user can re-run the same operation
 * by hand to verify behavior.
 */
export function mcpToolToCli(tool: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, any>;
  const proj = a.project ?? "<project>";
  const feat = a.feature;
  const repo = a.repo;
  const repos: string[] | undefined = a.repos;
  const reposPart = repos && repos.length > 0 ? ` ${repos.join(" ")}` : "";
  const repoPart = repo ? ` ${repo}` : "";

  switch (tool) {
    case "banyan_list_projects":
      return `bn ls`;
    case "banyan_project_info":
      return `bn ${proj} info`;
    case "banyan_list_features":
      return `bn ${proj} wt-ls`;
    case "banyan_feature_status":
      return `bn ${proj} wt-ls   # then 'git -C <wt> status' per repo of feature ${feat}`;
    case "banyan_list_stacks":
      return `bn ${proj} env ls`;
    case "banyan_get_stack_ports":
      return `docker compose -p ${proj}-${feat} port <service> <containerPort>`;
    case "banyan_stack_logs": {
      const service = a.service ? ` ${a.service}` : "";
      return `bn ${proj} env logs ${feat}${service}`;
    }
    case "banyan_create_feature":
      return `bn ${proj} wt ${feat}${reposPart}`;
    case "banyan_remove_feature":
      return `bn ${proj} wt-rm ${feat}${repoPart}`;
    case "banyan_cleanup_feature":
      return `bn ${proj} cleanup ${feat}${repoPart}`;
    case "banyan_start_test":
      return `bn ${proj} start ${feat}${reposPart}`;
    case "banyan_stop_test":
      return `bn ${proj} stop ${feat}`;
    case "banyan_stack_up":
      return `bn ${proj} env up ${feat}`;
    case "banyan_stack_down":
      return `bn ${proj} env down ${feat}`;
    case "banyan_stack_recreate":
      return `bn ${proj} env recreate ${feat}`;
    case "banyan_rebase_feature": {
      const base = a.base ? ` --base ${a.base}` : "";
      return `bn ${proj} rebase ${feat}${repoPart}${base}`;
    }
    case "banyan_merge_feature": {
      const flags: string[] = [];
      if (a.autoResolve === true) flags.push("--auto-resolve");
      if (a.local === true) flags.push("--local");
      if (a.strategy) flags.push(`--strategy ${a.strategy}`);
      const flagPart = flags.length > 0 ? " " + flags.join(" ") : "";
      return `bn ${proj} merge ${feat}${repoPart}${flagPart}`;
    }
    default:
      return `# no CLI mapping for ${tool}`;
  }
}
