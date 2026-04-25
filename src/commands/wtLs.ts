import path from "node:path";
import type { Context } from "../context.js";
import * as git from "../git.js";
import * as docker from "../docker.js";

export async function wtLs(ctx: Context): Promise<void> {
  for (const repo of ctx.project.repos) {
    if (repo.type === "compose") {
      ctx.logger.info(`== ${repo.name} (compose: ${repo.composeFile}) ==`);
      // Compose repos don't have "worktrees"; we surface any currently running
      // feature stacks by listing docker compose projects prefixed with our project name.
      const stacks = await listFeatureStacks(ctx.project.name, repo);
      if (stacks.length === 0) {
        ctx.logger.info("  (no active stacks)");
      } else {
        for (const s of stacks) {
          const running = s.running ? "● running" : "○ stopped";
          ctx.logger.info(`  ${s.feature}  [${running}]`);
        }
      }
      ctx.logger.info("");
      continue;
    }

    ctx.logger.info(`== ${repo.name} (${repo.path}) ==`);
    try {
      const entries = await git.worktreeList(repo.path);
      const primary = path.resolve(repo.path);
      const extras = entries.filter((e) => path.resolve(e.path) !== primary);
      if (extras.length === 0) {
        ctx.logger.info("  (no worktrees)");
      } else {
        for (const e of extras) {
          const branchStr = e.branch ? ` [${e.branch}]` : "";
          ctx.logger.info(`  ${e.path}${branchStr}`);
        }
      }
    } catch (err) {
      ctx.logger.warn(`  error: ${(err as Error).message}`);
    }
    ctx.logger.info("");
  }
}

/**
 * Query docker for all compose projects starting with "<project>-" and extract the
 * feature name + running state for each one.
 */
async function listFeatureStacks(
  projectName: string,
  _repo: unknown,
): Promise<{ feature: string; running: boolean }[]> {
  // docker compose ls outputs one line per project
  const { run } = await import("../exec.js");
  const r = await run("docker", ["compose", "ls", "--all", "--format", "json"]);
  if (r.code !== 0) return [];
  try {
    const arr = JSON.parse(r.stdout) as Array<{ Name: string; Status: string }>;
    const prefix = projectName + "-";
    return arr
      .filter((p) => p.Name.startsWith(prefix))
      .map((p) => ({
        feature: p.Name.slice(prefix.length),
        running: p.Status.includes("running"),
      }));
  } catch {
    return [];
  }
}
