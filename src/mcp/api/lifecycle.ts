/**
 * Feature + stack lifecycle — state-mutating ops backing the matching MCP
 * tools (create/remove/cleanup/start/stop/stack-up|down|recreate/rebase/
 * merge/finalize).
 *
 * `finalizeFeatureName` carries the two `migrate*` helpers because they're
 * only used during the draft→real rename — keeping them next to the caller
 * avoids exporting internal details from a shared module.
 */
import { getProject } from "../../config.js";
import * as git from "../../git.js";
import * as docker from "../../docker.js";
import * as tmux from "../../tmux.js";
import * as naming from "../../naming.js";
import { readAgentState, writeAgentState, deleteAgentState } from "../../agentState.js";
import { wtAll } from "../../commands/wtAll.js";
import { wtRm } from "../../commands/wtRm.js";
import { cleanup } from "../../commands/cleanup.js";
import { merge as mergeCmd } from "../../commands/merge.js";
import { rebase as rebaseCmd } from "../../commands/rebase.js";
import { test as testCmd } from "../../commands/test.js";
import { testStop as testStopCmd } from "../../commands/testStop.js";
import { envUp, envDown, envRecreate } from "../../commands/env.js";
import { buildContext } from "../../context.js";
import { getConfig } from "./shared.js";

export async function createFeature(
  projectName: string,
  feature: string,
  repos?: string[],
  initialPrompt?: string,
  prefix?: string,
  mode?: import("../../agentPrompt.js").AgentMode,
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
