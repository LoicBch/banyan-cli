import type { Context } from "../context.js";
import * as tmux from "../tmux.js";
import * as naming from "../naming.js";
import { run } from "../exec.js";
import { UsageError } from "../errors.js";

/**
 * `bn <proj> test-stop <feature>` — kill the test window and run each repo's
 * configured `run.stopCommand` in its feature worktree (if any).
 *
 * Agnostic design: banyan doesn't know Gradle, pm2, nodemon… You declare in
 * the config what "stop" means for each repo. Example:
 *
 *   run:
 *     command: ./gradlew run
 *     stopCommand: ./gradlew --stop
 *
 * Out-of-scope (use the matching command):
 *   - docker stacks → `env down` / `env recreate` / `cleanup`
 *   - git worktrees → `wt-rm` / `cleanup`
 */
export async function testStop(ctx: Context, feature: string): Promise<void> {
  if (!feature) {
    throw new UsageError(`usage: bn ${ctx.project.name} test-stop <feature>`);
  }
  const session = ctx.naming.session;
  const windowName = `test-${feature}`;
  const sessionExists = await tmux.hasSession(session);
  const windowExists = sessionExists && (await tmux.windowExists(session, windowName));

  if (sessionExists && windowExists) {
    await tmux.killWindow(session, windowName);
    ctx.logger.ok(`stopped test window '${feature}'`);
  } else {
    ctx.logger.info(`no test window for '${feature}'`);
  }

  // Run each repo's stopCommand in its feature worktree. Skip compose repos
  // and repos without a stopCommand or a missing worktree.
  for (const repo of ctx.project.repos) {
    if (repo.type === "compose") continue;
    const stopCmd = repo.run?.stopCommand;
    if (!stopCmd) continue;
    const wt = naming.existingWorktreePath(repo.path, feature);
    if (!wt) continue;

    ctx.logger.info(`running stopCommand for ${repo.name}: ${stopCmd}`);
    const r = await run("sh", ["-c", stopCmd], { cwd: wt });
    if (r.code === 0) {
      ctx.logger.ok(`stopped ${repo.name}`);
    } else {
      ctx.logger.warn(
        `stopCommand for ${repo.name} exited ${r.code}: ${r.stderr.trim() || r.stdout.trim()}`,
      );
    }
  }
}
