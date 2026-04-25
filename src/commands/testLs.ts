import type { Context } from "../context.js";
import * as tmux from "../tmux.js";

export async function testLs(ctx: Context): Promise<void> {
  if (!(await tmux.hasSession(ctx.naming.session))) {
    ctx.logger.info(`session '${ctx.naming.session}' not running`);
    return;
  }

  const wins = await tmux.listWindows(ctx.naming.session);
  const tests = wins.filter((w) => w.name.startsWith("test-"));
  if (tests.length === 0) {
    ctx.logger.info("no tests running");
    return;
  }
  ctx.logger.info(`running tests (${tests.length}):`);
  for (const w of tests) {
    ctx.logger.info(`  ${w.name.slice("test-".length)} (window ${w.name})`);
  }
}
