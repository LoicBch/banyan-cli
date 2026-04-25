import type { Context } from "../context.js";
import * as tmux from "../tmux.js";

export async function status(ctx: Context): Promise<void> {
  const running = await tmux.hasSession(ctx.naming.session);
  if (!running) {
    ctx.logger.info("stopped");
    return;
  }
  ctx.logger.info("running");
  const wins = await tmux.listWindows(ctx.naming.session);
  for (const w of wins) {
    const marker = w.active ? "*" : " ";
    ctx.logger.info(`  ${marker} ${w.name}`);
  }
}
