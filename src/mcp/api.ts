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
import * as tmux from "../tmux.js";
import * as naming from "../naming.js";
import { readAgentState, writeAgentState, deleteAgentState } from "../agentState.js";
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
import {
  approveReport,
  rejectReport,
  reportApprovalStatus,
  type ReportApprovalState,
  type ReportApprovalStatus,
} from "../reportApproval.js";
import { buildContext } from "../context.js";
import { UsageError } from "../errors.js";

async function getConfig(): Promise<Config> {
  return loadConfig();
}

// ---------------------------------------------------------------------------
// Discovery / read-only
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<{
  projects: Array<{ name: string; repos: string[] }>;
}> {
  const config = await getConfig();
  return {
    projects: config.projects.map((p) => ({
      name: p.name,
      repos: p.repos.map((r) => r.name),
    })),
  };
}

export async function projectInfo(
  projectName: string,
): Promise<{
  name: string;
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

export async function approveFeatureReport(
  projectName: string,
  feature: string,
): Promise<{ ok: true; state: ReportApprovalState }> {
  await validateProject(projectName);
  const r = reportApprovalStatus(projectName, feature);
  if (!r.latestReportTs) {
    throw new UsageError(`no report submitted for ${projectName}/${feature}`);
  }
  return { ok: true, state: approveReport(projectName, feature, r.latestReportTs) };
}

export async function rejectFeatureReport(
  projectName: string,
  feature: string,
  note?: string,
): Promise<{ ok: true; state: ReportApprovalState }> {
  await validateProject(projectName);
  const r = reportApprovalStatus(projectName, feature);
  if (!r.latestReportTs) {
    throw new UsageError(`no report submitted for ${projectName}/${feature}`);
  }
  return {
    ok: true,
    state: rejectReport(projectName, feature, r.latestReportTs, note),
  };
}

export async function getFeatureReportApproval(
  projectName: string,
  feature: string,
): Promise<{
  status: ReportApprovalStatus;
  latestReportTs: string | null;
  state: ReportApprovalState | null;
}> {
  await validateProject(projectName);
  const r = reportApprovalStatus(projectName, feature);
  return {
    status: r.status,
    latestReportTs: r.latestReportTs,
    state: r.state ?? null,
  };
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

/**
 * Promote the current draft worktree to a real feature name.
 *
 * Full rename — everything ends up named consistently:
 *   1. Validate the requested name
 *   2. Detect the draft feature from the agent's cwd
 *   3. Find which project owns it
 *   4. Refuse if the target name is already taken in this project
 *   5. For each repo with a draft worktree:
 *        a. Rename the git branch (`git branch -m draft-X new`)
 *        b. Move the worktree dir (`git worktree move`) — inode preserved,
 *           so the agent keeps reading/writing without disruption
 *        c. Rename the Claude transcripts dir
 *           (~/.claude/projects/<old-encoded> → <new-encoded>) so a future
 *           `claude --continue` from the new cwd finds the conversation
 *   6. Re-tag the tmux pane (@banyan-pane + title) and send `cd <new>` so
 *      the shell's PS1 refreshes
 *   7. Migrate banyan state files (agent state, system prompt, launch script)
 *   8. Start the project's compose stacks under the FINAL name (no rename:
 *      they were never started under the draft name — see wtAll Phase 1)
 */
export async function finalizeFeatureName(
  newName: string,
): Promise<{
  ok: true;
  project: string;
  oldFeature: string;
  newFeature: string;
  reposRenamed: string[];
  newWorktreePaths: Record<string, string>;
}> {
  // 1. Validate the requested name (kebab-case, not itself a draft).
  naming.assertValidFinalizedFeature(newName);

  // 2. Detect the draft feature from the current process cwd.
  const cwd = process.cwd();
  const { sep } = await import("node:path");
  const parts = cwd.split(sep);
  let draftFeature: string | undefined;
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i]!.startsWith("worktree-")) {
      const candidate = parts[i + 1];
      if (candidate && naming.isDraftFeature(candidate)) {
        draftFeature = candidate;
      }
      break;
    }
  }
  if (!draftFeature) {
    throw new Error(
      "finalizeFeatureName called from outside a draft worktree (cwd: " + cwd + ")",
    );
  }

  // 3. Find which project owns this draft (a project whose repos have a
  //    worktree matching this draft feature).
  const config = await getConfig();
  let matchedProject: string | undefined;
  const repoRenames: Array<{ repoName: string; repoPath: string; worktreePath: string; oldBranch: string }> = [];
  for (const project of config.projects) {
    for (const repo of project.repos) {
      if (repo.type === "compose") continue;
      const worktrees = await git.worktreeList(repo.path).catch(() => []);
      for (const wt of worktrees) {
        if (wt.path === repo.path) continue;
        const parsed = naming.parseWorktreePath(wt.path, repo.path);
        if (parsed?.feature === draftFeature && wt.branch) {
          if (matchedProject && matchedProject !== project.name) {
            // Two projects shouldn't share a draft slug, but bail loudly if so.
            throw new Error(
              `draft '${draftFeature}' found in multiple projects (${matchedProject}, ${project.name}); cannot finalize unambiguously`,
            );
          }
          matchedProject = project.name;
          repoRenames.push({
            repoName: repo.name,
            repoPath: repo.path,
            worktreePath: wt.path,
            oldBranch: wt.branch,
          });
        }
      }
    }
  }
  if (!matchedProject || repoRenames.length === 0) {
    throw new Error(`could not locate any banyan worktree for draft '${draftFeature}'`);
  }

  // 4. Refuse if another feature with the target name already exists in this
  //    project (would collide on branch / tmux pane / state file).
  const project = getProject(config, matchedProject);
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    if (naming.existingWorktreePath(repo.path, newName)) {
      throw new Error(
        `feature '${newName}' already has a worktree in repo '${repo.name}'. pick a different name.`,
      );
    }
  }

  // 5. Per-repo rename: branch + worktree dir + transcripts dir.
  const reposRenamed: string[] = [];
  const newWorktreePaths: Record<string, string> = {}; // repoName → new path
  for (const r of repoRenames) {
    // a) Branch — swap the trailing segment, keep any prefix.
    const segments = r.oldBranch.split("/");
    segments[segments.length - 1] = newName;
    const newBranch = segments.join("/");
    await git.renameBranch(r.repoPath, r.oldBranch, newBranch);

    // b) Worktree dir — `git worktree move` preserves inode. The agent's
    //    shell keeps working through its open fd on the dir.
    const newWtPath = naming.worktreePath(r.repoPath, newName);
    try {
      await git.worktreeMove(r.repoPath, r.worktreePath, newWtPath);
    } catch (err) {
      // If the move fails (target exists, locked, etc.) we leave the dir
      // as draft-X and continue — the branch is still renamed, which is the
      // primary contract. Surface the issue but don't abort the finalize.
      console.error(`[finalize] worktree move failed for ${r.repoName}: ${(err as Error).message}`);
    }
    newWorktreePaths[r.repoName] = newWtPath;

    // c) Transcripts dir under `~/.claude/projects/<encoded-cwd>`. The
    //    encoded name is the path with `/` → `-`. Renaming lets
    //    `claude --continue` from the new cwd find the prior conversation
    //    on the next launch.
    await migrateClaudeTranscriptsDir(r.worktreePath, newWtPath);

    reposRenamed.push(r.repoName);
  }

  // 6. Re-tag the tmux pane: title + @banyan-pane, then send `cd <new>` so
  //    the shell's PS1 reflects the new cwd. The agent process itself doesn't
  //    notice the dir rename (inode is the same), but its visible prompt
  //    string is stale until the cd.
  const session = naming.sessionName(matchedProject);
  const agentsWin = naming.agentsWindowName(matchedProject);
  if (await tmux.hasSession(session) && await tmux.windowExists(session, agentsWin)) {
    const paneId = await tmux.findPaneByUserOption(
      session,
      agentsWin,
      "@banyan-pane",
      draftFeature,
    );
    if (paneId) {
      await tmux.setPaneUserOption(paneId, "@banyan-pane", newName);
      await tmux.setPaneTitle(paneId, newName);
      // NOTE: we deliberately do NOT send `cd` here — the claude process
      // owns this pane's stdin, not a shell. Sending keys would inject them
      // into claude's UI. The agent's working dir is still valid via inode.
      // The next time the user (or restart) lands a fresh shell here, it'll
      // be at the new path automatically.
    }
  }

  // 7. Migrate banyan state files (agent state + prompt + launch script).
  const oldAgent = readAgentState(matchedProject, draftFeature);
  if (oldAgent) {
    writeAgentState({
      project: matchedProject,
      feature: newName,
      mode: oldAgent.mode,
      ...(oldAgent.requireApproval ? { requireApproval: true } : {}),
    });
    deleteAgentState(matchedProject, draftFeature);
  }
  await migrateBanyanStateFiles(matchedProject, draftFeature, newName);

  // 8. Start the project's compose stacks under the FINAL name. They were
  //    deliberately skipped in wtAll Phase 1 when feature was a draft.
  for (const repo of project.repos) {
    if (repo.type !== "compose") continue;
    try {
      await docker.up(repo, project, newName);
    } catch (err) {
      console.error(`[finalize] docker.up failed for ${repo.name}: ${(err as Error).message}`);
    }
  }

  return {
    ok: true,
    project: matchedProject,
    oldFeature: draftFeature,
    newFeature: newName,
    reposRenamed,
    newWorktreePaths,
  };
}

/** Rename ~/.claude/projects/<old-encoded-cwd> → <new-encoded-cwd> so
 *  `claude --continue` from the new path finds the prior conversation.
 *  Silent best-effort: if the source dir doesn't exist (no prior session),
 *  or the destination already exists, we skip. */
async function migrateClaudeTranscriptsDir(
  oldCwd: string,
  newCwd: string,
): Promise<void> {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = path.join(os.homedir(), ".claude", "projects");
  const encode = (p: string) => p.replace(/\//g, "-");
  const oldDir = path.join(root, encode(oldCwd));
  const newDir = path.join(root, encode(newCwd));
  if (!fs.existsSync(oldDir)) return;
  if (fs.existsSync(newDir)) return; // don't clobber
  try {
    fs.renameSync(oldDir, newDir);
  } catch {
    // best-effort
  }
}

/** Move `~/.config/banyan/state/<project>.<oldFeature>.{prompt.md,launch.sh}`
 *  to use newFeature. The agent-state file is already handled by readAgentState
 *  / writeAgentState. */
async function migrateBanyanStateFiles(
  projectName: string,
  oldFeature: string,
  newFeature: string,
): Promise<void> {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = path.join(os.homedir(), ".config", "banyan", "state");
  for (const suffix of ["prompt.md", "launch.sh"]) {
    const src = path.join(dir, `${projectName}.${oldFeature}.${suffix}`);
    const dst = path.join(dir, `${projectName}.${newFeature}.${suffix}`);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try { fs.renameSync(src, dst); } catch { /* ignore */ }
    }
  }
}

export async function mergeFeature(
  projectName: string,
  feature: string,
  repo?: string,
  opts: { noResolve?: boolean; local?: boolean } = {},
): Promise<{ ok: true }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const targets = repo ? [repo] : project.repos.map((r) => r.name).filter((n) => {
    const r = project.repos.find((x) => x.name === n)!;
    return r.type !== "compose";
  });
  for (const r of targets) {
    await mergeCmd(await buildContext(config, projectName, { feature, repoName: r }), {
      // Resolver runs by default in MCP-driven merges (orchestrator path).
      noResolve: opts.noResolve ?? false,
      local: opts.local,
    });
  }
  return { ok: true };
}
