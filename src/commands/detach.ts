import type { Context } from "../context.js";
import * as tmux from "../tmux.js";

export async function detach(ctx: Context): Promise<void> {
  const has = await tmux.hasSession(ctx.naming.session);
  if (!has) {
    ctx.logger.info(`session '${ctx.naming.session}' not running`);
    return;
  }
  await tmux.detachClients(ctx.naming.session);
  ctx.logger.ok(`detached clients from ${ctx.naming.session}`);
}
