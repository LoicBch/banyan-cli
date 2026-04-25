import type { Context } from "../context.js";
import * as tmux from "../tmux.js";

export async function stop(ctx: Context): Promise<void> {
  const has = await tmux.hasSession(ctx.naming.session);
  if (!has) {
    ctx.logger.info(`session '${ctx.naming.session}' not running`);
    return;
  }
  await tmux.killSession(ctx.naming.session);
  ctx.logger.ok(`killed session ${ctx.naming.session}`);
}
