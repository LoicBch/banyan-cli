/**
 * `bn <project> orchestrator` — optional cross-feature agent.
 *
 * Spawns a single Claude session with:
 *   - read access to the parent dir of every repo (so it sees current AND
 *     future feature worktrees automatically),
 *   - the banyan MCP server wired in (so it can drive lifecycle: list /
 *     create / merge / cleanup features),
 *   - a system prompt explaining the orchestrator role.
 *
 * Lives in its own tmux window `orchestrator-<proj>` inside the project
 * session — separate from the per-feature panes in `agents-<proj>`.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Context } from "../context.js";
import * as tmux from "../tmux.js";
import * as naming from "../naming.js";
import * as git from "../git.js";
import { UsageError } from "../errors.js";

const SESSION_FILE_DIR = path.join(homedir(), ".config", "banyan");
const MCP_CONFIG_PATH = path.join(SESSION_FILE_DIR, "orchestrator-mcp.json");

function sessionFilePath(projectName: string): string {
  return path.join(SESSION_FILE_DIR, `${projectName}.orchestrator.session`);
}

function ensureMcpConfig(): string {
  mkdirSync(SESSION_FILE_DIR, { recursive: true });
  const cfg = {
    mcpServers: {
      banyan: {
        command: "banyan",
        args: ["mcp-serve"],
      },
    },
  };
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  return MCP_CONFIG_PATH;
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_:/.@=+,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildSystemPrompt(projectName: string): string {
  return [
    `You are the orchestrator agent for the banyan project "${projectName}".`,
    ``,
    `Scope:`,
    `- Multiple parallel features are being developed in this project. Each runs`,
    `  in its own git worktree, with its own per-feature Claude agent in a`,
    `  separate tmux pane (window 'agents-${projectName}').`,
    `- You have read access to the parent directory of every repo, so you can`,
    `  see all current and future feature worktrees.`,
    `- You have the banyan MCP tools available (banyan_list_features,`,
    `  banyan_feature_status, banyan_get_stack_ports, banyan_create_feature,`,
    `  banyan_merge_feature, banyan_cleanup_feature, …). Use them to read`,
    `  state and act on the project.`,
    ``,
    `Use yourself for:`,
    `- Cross-feature awareness: detect when two in-flight features will likely`,
    `  conflict at merge.`,
    `- Strategic ordering: recommend a merge order that minimises rebase pain.`,
    `- Project-level housekeeping: clean up stale features, dump prod, recreate`,
    `  stacks, etc.`,
    `- Conflict resolution backup: if a per-feature agent gets stuck, you can`,
    `  step in with cross-feature context.`,
    ``,
    `Don't:`,
    `- Replace the per-feature agents. Their pane is the right place for`,
    `  feature-specific implementation.`,
    `- Push without explicit user direction. Use the merge tools when asked.`,
  ].join("\n");
}

function uniqueParentDirs(repoPaths: string[]): string[] {
  const seen = new Set<string>();
  for (const p of repoPaths) {
    seen.add(path.dirname(p));
  }
  return [...seen];
}

export async function start(ctx: Context): Promise<number> {
  const project = ctx.project;
  const session = naming.sessionName(project.name);
  const window = naming.orchestratorWindowName(project.name);

  // If session + orchestrator window already exist, just attach.
  if (
    (await tmux.hasSession(session)) &&
    (await tmux.windowExists(session, window))
  ) {
    ctx.logger.info(`orchestrator already running — attaching`);
    await tmux.selectWindow(session, window);
    return await tmux.attach(session);
  }

  // Build the --add-dir list: parent dir of each non-compose repo.
  const gitRepos = project.repos.filter((r) => r.type !== "compose");
  if (gitRepos.length === 0) {
    throw new UsageError(
      `project "${project.name}" has no git repos to scope the orchestrator on`,
    );
  }
  const parentDirs = uniqueParentDirs(gitRepos.map((r) => r.path));

  // Use the first repo's main path as cwd so the orchestrator boots inside a
  // sane git context (it can still reach all other parent dirs via --add-dir).
  const primaryCwd = gitRepos[0]!.path;

  // Generate the MCP config pointing at `banyan mcp-serve`.
  const mcpConfig = ensureMcpConfig();

  // Optional: surface the current feature inventory in the system prompt.
  // Best-effort — failing here just means we use the static prompt.
  let initialSummary = "";
  try {
    const featureMap = new Map<string, string[]>();
    for (const repo of gitRepos) {
      const wts = await git.worktreeList(repo.path).catch(() => []);
      for (const wt of wts) {
        if (wt.path === repo.path) continue;
        if (!wt.path.startsWith(`${repo.path}-`)) continue;
        const feat = wt.path.slice(repo.path.length + 1);
        const list = featureMap.get(feat) ?? [];
        list.push(repo.name);
        featureMap.set(feat, list);
      }
    }
    if (featureMap.size > 0) {
      const lines = ["", "Current features:"];
      for (const [feat, repos] of featureMap.entries()) {
        lines.push(`  - ${feat}  (repos: ${repos.join(", ")})`);
      }
      initialSummary = lines.join("\n");
    } else {
      initialSummary = "\nNo features active yet. Suggest banyan_create_feature to start one.";
    }
  } catch {
    // ignore
  }

  const systemPrompt = buildSystemPrompt(project.name) + initialSummary;

  // Resume previous session if we have one recorded.
  const sessFile = sessionFilePath(project.name);
  const resumeArg = existsSync(sessFile) ? "--continue " : "";

  const addDirArgs = parentDirs.map(shellQuote).join(" ");
  const claudeCmd =
    `claude ${resumeArg}` +
    `--mcp-config ${shellQuote(mcpConfig)} ` +
    `--add-dir ${addDirArgs} ` +
    `--append-system-prompt ${shellQuote(systemPrompt)}`;

  // Create or join the session, then ensure the orchestrator window exists.
  let paneId: string;
  if (!(await tmux.hasSession(session))) {
    paneId = await tmux.newSession(session, window, primaryCwd);
    ctx.logger.ok(`tmux session: ${session} (created)`);
    ctx.logger.ok(`tmux window: ${session}:${window}`);
  } else if (!(await tmux.windowExists(session, window))) {
    paneId = await tmux.newWindow(session, window, primaryCwd);
    ctx.logger.ok(`tmux window: ${session}:${window} (created)`);
  } else {
    // Should not reach here (we early-returned above), but be defensive.
    ctx.logger.info(`orchestrator already running — attaching`);
    return await tmux.attach(session);
  }

  await tmux.setPaneTitle(paneId, "orchestrator");
  await tmux.setPaneUserOption(paneId, "@banyan-pane", "orchestrator");
  await tmux.enablePaneBorderLabels(session, window);

  // Mark this orchestrator as started so the next start picks --continue.
  // We don't have a session id yet (claude generates one); the existence
  // of the file is sufficient for the heuristic.
  mkdirSync(SESSION_FILE_DIR, { recursive: true });
  writeFileSync(sessFile, new Date().toISOString(), "utf8");

  await tmux.sendKeys(paneId, claudeCmd, { enter: true });
  await tmux.selectWindow(session, window);

  ctx.logger.ok(
    `orchestrator launched (window: ${session}:${window}, ${parentDirs.length} parent dir${parentDirs.length > 1 ? "s" : ""})`,
  );
  ctx.logger.info(`attach with: bn ${project.name} attach`);
  return await tmux.attach(session);
}

export async function stop(ctx: Context): Promise<void> {
  const project = ctx.project;
  const session = naming.sessionName(project.name);
  const window = naming.orchestratorWindowName(project.name);

  if (!(await tmux.hasSession(session))) {
    ctx.logger.info(`session '${session}' not running`);
    return;
  }
  if (!(await tmux.windowExists(session, window))) {
    ctx.logger.info(`no orchestrator window for project '${project.name}'`);
    return;
  }
  await tmux.killWindow(session, window);
  ctx.logger.ok(`orchestrator stopped`);

  // Drop the session marker so the next start gets a fresh conversation.
  const sessFile = sessionFilePath(project.name);
  if (existsSync(sessFile)) {
    try {
      unlinkSync(sessFile);
    } catch {
      // ignore
    }
  }
}

export async function status(ctx: Context): Promise<void> {
  const project = ctx.project;
  const session = naming.sessionName(project.name);
  const window = naming.orchestratorWindowName(project.name);
  if (!(await tmux.hasSession(session))) {
    ctx.logger.info(`orchestrator: not running (session '${session}' absent)`);
    return;
  }
  if (!(await tmux.windowExists(session, window))) {
    ctx.logger.info(`orchestrator: not running (window absent)`);
    return;
  }
  ctx.logger.ok(`orchestrator: running at ${session}:${window}`);
  const sessFile = sessionFilePath(project.name);
  if (existsSync(sessFile)) {
    const ts = readFileSync(sessFile, "utf8").trim();
    ctx.logger.info(`  started/recorded: ${ts}`);
  }
}
