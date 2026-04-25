import { existsSync } from "node:fs";
import type { Context } from "../context.js";
import { runInherit } from "../exec.js";
import * as tmux from "../tmux.js";
import { UsageError } from "../errors.js";

export async function start(ctx: Context): Promise<number> {
  const script = ctx.project.layoutScript;

  if (script) {
    if (!existsSync(script)) {
      throw new UsageError(`layout script not found: ${script}`);
    }
    return runInherit("/bin/bash", [script]);
  }

  return startDefaultLayout(ctx);
}

async function startDefaultLayout(ctx: Context): Promise<number> {
  const session = ctx.naming.session;

  if (await tmux.hasSession(session)) {
    ctx.logger.info(`session '${session}' already running; attaching…`);
    return tmux.attach(session);
  }

  const [first, ...rest] = ctx.project.repos;
  if (!first) {
    throw new UsageError(`project '${ctx.project.name}' has no repos`);
  }

  await tmux.newSession(session, first.name, first.path);
  for (const r of rest) {
    await tmux.newWindow(session, r.name, r.path);
  }
  await tmux.selectWindow(session, first.name);

  ctx.logger.ok(
    `started default layout: session '${session}', one window per repo (${ctx.project.repos.map((r) => r.name).join(", ")})`,
  );
  return tmux.attach(session);
}
