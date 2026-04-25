import type { Context } from "../context.js";
import * as tmux from "../tmux.js";
import { UsageError } from "../errors.js";

export async function attach(ctx: Context): Promise<number> {
  if (!(await tmux.hasSession(ctx.naming.session))) {
    throw new UsageError(
      `session '${ctx.naming.session}' not running — start with: bn ${ctx.project.name} start`,
    );
  }
  return tmux.attach(ctx.naming.session);
}
