/**
 * MCP API surface — thin wrappers around banyan internals that return
 * structured data (not just log to stdout). Each function maps 1:1 to a
 * registered MCP tool.
 *
 * Conventions:
 *  - Read-only ops return rich JSON.
 *  - Action ops return `{ ok: true, ... }` on success or throw a UsageError
 *    that the MCP layer translates into a tool error.
 *  - All paths returned are absolute, all branch/feature names are unsanitized.
 */

import { existsSync } from "node:fs";
import {
  getProject,
  loadConfig,
  type Config,
} from "../config.js";
import * as git from "../git.js";
import * as docker from "../docker.js";
import * as naming from "../naming.js";
import { run } from "../exec.js";
import { wtAll } from "../commands/wtAll.js";
import { wtRm } from "../commands/wtRm.js";
import { cleanup } from "../commands/cleanup.js";
import { merge as mergeCmd } from "../commands/merge.js";
import { rebase as rebaseCmd } from "../commands/rebase.js";
import { test as testCmd } from "../commands/test.js";
import { testStop as testStopCmd } from "../commands/testStop.js";
import { envUp, envDown, envRecreate } from "../commands/env.js";
import { assignTask as assignTaskCmd } from "../commands/assignTask.js";
import {
  appendReport,
  readReports,
  type ReportInput,
  type FeatureReport,
} from "../reports.js";
import {
  setTodo,
  addTodoItems,
  markTodoDone,
  markTodoUndone,
  removeTodoItems,
  getTodo,
  type FeatureTodo,
} from "../todo.js";
import {
  requestApproval,
  approvePlan,
  rejectPlan,
  getApproval,
  approvalStatus,
  type ApprovalState,
  type ApprovalStatus,
} from "../approval.js";
import { buildContext } from "../context.js";
import { UsageError } from "../errors.js";

async function getConfig(): Promise<Config> {
  return loadConfig();
}

// ---------------------------------------------------------------------------
// Discovery / read-only
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<{
  projects: Array<{ name: string; repos: string[]; layoutScript?: string }>;
}> {
  const config = await getConfig();
  return {
    projects: config.projects.map((p) => ({
      name: p.name,
      repos: p.repos.map((r) => r.name),
      layoutScript: p.layoutScript,
    })),
  };
}

export async function projectInfo(
  projectName: string,
): Promise<{
  name: string;
  layoutScript?: string;
  deployCommand?: string;
  repos: Array<{
    name: string;
    type: "git" | "compose";
    path: string;
    baseBranch?: string;
    composeFile?: string;
    run?: {
      command: string;
      port?: number;
      portEnv?: string;
      setup?: string;
      stopCommand?: string;
      env?: Record<string, string>;
      composePorts?: Record<string, string>;
    };
    deployCommand?: string;
  }>;
}> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  return {
    name: project.name,
    layoutScript: project.layoutScript,
    deployCommand: project.deployCommand,
    repos: project.repos.map((r) => ({
      name: r.name,
      type: r.type ?? "git",
      path: r.path,
      baseBranch: r.baseBranch,
      composeFile: r.composeFile,
      run: r.run,
      deployCommand: r.deployCommand,
    })),
  };
}

export async function listFeatures(projectName: string): Promise<{
  features: Array<{
    feature: string;
    repos: Array<{ name: string; worktreePath: string; branch: string }>;
  }>;
}> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  // Discover features by scanning sibling worktree dirs of each git repo
  const featureMap = new Map<
    string,
    Array<{ name: string; worktreePath: string; branch: string }>
  >();
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    const worktrees = await git.worktreeList(repo.path).catch(() => []);
    for (const wt of worktrees) {
      // Main checkout's path matches the repo path; skip it.
      if (wt.path === repo.path) continue;
      const parsed = naming.parseWorktreePath(wt.path, repo.path);
      if (!parsed) continue;
      const list = featureMap.get(parsed.feature) ?? [];
      list.push({
        name: repo.name,
        worktreePath: wt.path,
        branch: wt.branch ?? "(detached)",
      });
      featureMap.set(parsed.feature, list);
    }
  }
  return {
    features: Array.from(featureMap.entries()).map(([feature, repos]) => ({
      feature,
      repos,
    })),
  };
}

export async function featureStatus(
  projectName: string,
  feature: string,
): Promise<{
  feature: string;
  repos: Array<{
    name: string;
    type: string;
    worktreePath?: string;
    branch?: string;
    exists: boolean;
    head?: string;
    dirty?: boolean;
    aheadOfBase?: number;
  }>;
}> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const repos: Array<{
    name: string;
    type: string;
    worktreePath?: string;
    branch?: string;
    exists: boolean;
    head?: string;
    dirty?: boolean;
    aheadOfBase?: number;
  }> = [];
  for (const r of project.repos) {
    if (r.type === "compose") {
      repos.push({ name: r.name, type: "compose", exists: true });
      continue;
    }
    const wt = naming.existingWorktreePath(r.path, feature)
      ?? naming.worktreePath(r.path, feature);
    const exists = existsSync(wt);
    if (!exists) {
      repos.push({ name: r.name, type: "git", worktreePath: wt, exists: false });
      continue;
    }
    const branch = naming.branchName(feature);
    const head = await git.currentHead(wt).catch(() => undefined);
    const dirty = await git.hasUncommittedChanges(wt).catch(() => undefined);
    const base = await git.defaultBranch(r.path, r.baseBranch);
    const aheadOfBase = await git
      .commitsAhead(wt, `origin/${base}`)
      .catch(() => undefined);
    repos.push({
      name: r.name,
      type: "git",
      worktreePath: wt,
      branch,
      exists: true,
      head,
      dirty,
      aheadOfBase,
    });
  }
  return { feature, repos };
}

export async function listStacks(projectName: string): Promise<{
  stacks: Array<{ feature: string; running: boolean; status: string }>;
}> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const r = await run("docker", ["compose", "ls", "--all", "--format", "json"]);
  if (r.code !== 0) return { stacks: [] };
  let parsed: Array<{ Name: string; Status: string }>;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { stacks: [] };
  }
  const prefix = project.name + "-";
  return {
    stacks: parsed
      .filter((s) => s.Name.startsWith(prefix))
      .map((s) => ({
        feature: s.Name.slice(prefix.length),
        running: s.Status.includes("running"),
        status: s.Status,
      })),
  };
}

export async function getStackPorts(
  projectName: string,
  feature: string,
): Promise<{
  stack: string;
  ports: Array<{ service: string; containerPort: number; hostPort: number }>;
}> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const composeRepo = project.repos.find((r) => r.type === "compose");
  if (!composeRepo) {
    throw new UsageError(`project "${projectName}" has no compose repo`);
  }
  if (!(await docker.isUp(composeRepo, project, feature))) {
    return {
      stack: docker.composeProjectName(project, feature),
      ports: [],
    };
  }
  // Use composePorts spec from any non-compose repo to know which ports to ask for
  const ports: Array<{ service: string; containerPort: number; hostPort: number }> = [];
  const seen = new Set<string>();
  for (const r of project.repos) {
    const spec = r.run?.composePorts ?? {};
    for (const target of Object.values(spec)) {
      const [service, portStr] = target.split(":");
      if (!service || !portStr) continue;
      const containerPort = parseInt(portStr, 10);
      const key = `${service}:${containerPort}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hostPort = await docker.servicePort(
        composeRepo,
        project,
        feature,
        service,
        containerPort,
      );
      if (hostPort) ports.push({ service, containerPort, hostPort });
    }
  }
  return {
    stack: docker.composeProjectName(project, feature),
    ports,
  };
}

export async function stackLogs(
  projectName: string,
  feature: string,
  service?: string,
  tail = 100,
): Promise<{ logs: string }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const composeRepo = project.repos.find((r) => r.type === "compose");
  if (!composeRepo) throw new UsageError(`project "${projectName}" has no compose repo`);
  const composeProject = docker.composeProjectName(project, feature);
  const args = [
    "compose",
    "-p",
    composeProject,
    "-f",
    composeRepo.composeFile?.startsWith("/")
      ? composeRepo.composeFile
      : `${composeRepo.path}/${composeRepo.composeFile}`,
    "--project-directory",
    composeRepo.path,
    "logs",
    "--tail",
    String(tail),
  ];
  if (service) args.push(service);
  const r = await run("docker", args);
  return { logs: (r.stdout || "") + (r.stderr || "") };
}

// ---------------------------------------------------------------------------
// Lifecycle (state-changing)
// ---------------------------------------------------------------------------

export async function createFeature(
  projectName: string,
  feature: string,
  repos?: string[],
  initialPrompt?: string,
  prefix?: string,
  mode?: import("../agentPrompt.js").AgentMode,
  requireApproval?: boolean,
): Promise<{ ok: true; feature: string }> {
  const config = await getConfig();
  // MCP-driven creation defaults to `autonomous` (the orchestrator is by
  // construction delegating). Caller can pass mode="interactive" for a
  // hands-on session, "autopilot" for full TODO-list autopilot, etc.
  const effectiveMode = mode ?? "autonomous";
  await wtAll(config, projectName, feature, {
    ...(repos && repos.length > 0 ? { only: repos } : {}),
    ...(initialPrompt ? { initialPrompt } : {}),
    ...(prefix !== undefined ? { prefix } : {}),
    mode: effectiveMode,
    ...(requireApproval ? { requireApproval } : {}),
  });
  return { ok: true, feature };
}

export async function assignTask(
  projectName: string,
  feature: string,
  prompt: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: true; paneId: string }> {
  const config = await getConfig();
  const { paneId } = await assignTaskCmd(config, projectName, feature, prompt, opts);
  return { ok: true, paneId };
}

/**
 * Submit an end-of-task report for a feature. Validates the project exists,
 * then appends to the project's timeline. Multiple reports per feature are
 * allowed (status updates, v1 / v2 of "done") — the timeline keeps history.
 */
export async function reportDone(
  projectName: string,
  feature: string,
  input: ReportInput,
): Promise<{ ok: true; ts: string }> {
  const config = await getConfig();
  getProject(config, projectName); // validates project exists, throws otherwise
  if (!input.summary || !input.summary.trim()) {
    throw new UsageError("summary is required");
  }
  if (!input.testInstructions || !input.testInstructions.trim()) {
    throw new UsageError("testInstructions is required");
  }
  const record = appendReport(projectName, feature, input);
  return { ok: true, ts: record.ts };
}

/**
 * Read reports from a project's timeline. Optional filters: by feature,
 * by date (ISO timestamp), and `latestOnly` to collapse to one per feature.
 */
export async function listReports(
  projectName: string,
  opts: { feature?: string; since?: string; latestOnly?: boolean } = {},
): Promise<{ reports: FeatureReport[] }> {
  const config = await getConfig();
  getProject(config, projectName);
  return { reports: readReports(projectName, opts) };
}

// ---------------------------------------------------------------------------
// TODO list per feature
// ---------------------------------------------------------------------------

async function validateProject(projectName: string): Promise<void> {
  const config = await getConfig();
  getProject(config, projectName); // throws on unknown
}

export async function setFeatureTodo(
  projectName: string,
  feature: string,
  items: string[],
): Promise<{ ok: true; todo: FeatureTodo }> {
  await validateProject(projectName);
  const todo = setTodo(projectName, feature, items);
  return { ok: true, todo };
}

export async function getFeatureTodo(
  projectName: string,
  feature: string,
): Promise<{ todo: FeatureTodo | null }> {
  await validateProject(projectName);
  return { todo: getTodo(projectName, feature) ?? null };
}

// ---------------------------------------------------------------------------
// Plan approval gate
// ---------------------------------------------------------------------------

export async function requestPlanApproval(
  projectName: string,
  feature: string,
): Promise<{ ok: true; state: ApprovalState }> {
  await validateProject(projectName);
  const state = requestApproval(projectName, feature);
  return { ok: true, state };
}

export async function approveFeaturePlan(
  projectName: string,
  feature: string,
): Promise<{ ok: true; state: ApprovalState }> {
  await validateProject(projectName);
  const state = approvePlan(projectName, feature);
  return { ok: true, state };
}

export async function rejectFeaturePlan(
  projectName: string,
  feature: string,
  note?: string,
): Promise<{ ok: true; state: ApprovalState }> {
  await validateProject(projectName);
  const state = rejectPlan(projectName, feature, note);
  return { ok: true, state };
}

export async function getFeatureApproval(
  projectName: string,
  feature: string,
): Promise<{ state: ApprovalState | null; status: ApprovalStatus }> {
  await validateProject(projectName);
  const state = getApproval(projectName, feature);
  return { state: state ?? null, status: approvalStatus(state) };
}

export async function updateFeatureTodo(
  projectName: string,
  feature: string,
  ops: {
    add?: string[];
    done?: string[];
    undone?: string[];
    remove?: string[];
  },
): Promise<{ ok: true; todo: FeatureTodo }> {
  await validateProject(projectName);
  let todo: FeatureTodo | undefined;
  if (ops.add && ops.add.length > 0) todo = addTodoItems(projectName, feature, ops.add);
  if (ops.done && ops.done.length > 0) todo = markTodoDone(projectName, feature, ops.done);
  if (ops.undone && ops.undone.length > 0) todo = markTodoUndone(projectName, feature, ops.undone);
  if (ops.remove && ops.remove.length > 0) todo = removeTodoItems(projectName, feature, ops.remove);
  if (!todo) {
    const cur = getTodo(projectName, feature);
    if (!cur) throw new UsageError(`no todo for ${projectName}/${feature} and no ops applied`);
    todo = cur;
  }
  return { ok: true, todo };
}

export async function removeFeature(
  projectName: string,
  feature: string,
  repo?: string,
  force?: boolean,
): Promise<{ ok: true }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const targets = repo ? [repo] : project.repos.map((r) => r.name);
  for (const r of targets) {
    await wtRm(
      await buildContext(config, projectName, { feature, repoName: r }),
      { force },
    );
  }
  return { ok: true };
}

export async function cleanupFeature(
  projectName: string,
  feature: string,
  repo?: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const targets = repo ? [repo] : project.repos.map((r) => r.name);
  for (const r of targets) {
    await cleanup(await buildContext(config, projectName, { feature, repoName: r }));
  }
  return { ok: true };
}

export async function startTest(
  projectName: string,
  feature: string,
  repos?: string[],
): Promise<{ ok: true; feature: string }> {
  const config = await getConfig();
  await testCmd(config, projectName, feature, repos);
  return { ok: true, feature };
}

export async function stopTest(
  projectName: string,
  feature: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  await testStopCmd(await buildContext(config, projectName, { feature }), feature);
  return { ok: true };
}

export async function stackUp(
  projectName: string,
  feature: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  await envUp(config, projectName, feature);
  return { ok: true };
}

export async function stackDown(
  projectName: string,
  feature: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  await envDown(config, projectName, feature);
  return { ok: true };
}

export async function stackRecreate(
  projectName: string,
  feature: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  await envRecreate(config, projectName, feature);
  return { ok: true };
}

export async function rebaseFeature(
  projectName: string,
  feature: string,
  repo?: string,
  base?: string,
): Promise<{ ok: true }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const targets = repo ? [repo] : project.repos.map((r) => r.name).filter((n) => {
    const r = project.repos.find((x) => x.name === n)!;
    return r.type !== "compose";
  });
  for (const r of targets) {
    await rebaseCmd(await buildContext(config, projectName, { feature, repoName: r }), { base });
  }
  return { ok: true };
}

export async function mergeFeature(
  projectName: string,
  feature: string,
  repo?: string,
  opts: { autoResolve?: boolean; strategy?: "squash" | "merge" | "rebase"; local?: boolean } = {},
): Promise<{ ok: true }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const targets = repo ? [repo] : project.repos.map((r) => r.name).filter((n) => {
    const r = project.repos.find((x) => x.name === n)!;
    return r.type !== "compose";
  });
  for (const r of targets) {
    await mergeCmd(await buildContext(config, projectName, { feature, repoName: r }), {
      autoResolve: opts.autoResolve ?? true, // default to auto in MCP
      strategy: opts.strategy,
      local: opts.local,
    });
  }
  return { ok: true };
}
