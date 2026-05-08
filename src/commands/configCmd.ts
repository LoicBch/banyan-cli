import type { Context } from "../context.js";
import { contractHome } from "../config.js";

export async function configShow(ctx: Context): Promise<void> {
  ctx.logger.info(`project: ${ctx.project.name}`);
  if (ctx.project.deployCommand) {
    ctx.logger.info(`deploy:  ${ctx.project.deployCommand}`);
  }
  ctx.logger.info(`repos:`);
  for (const r of ctx.project.repos) {
    const base = r.baseBranch ? ` (base: ${r.baseBranch})` : "";
    const strat = r.mergeStrategy ? ` (merge: ${r.mergeStrategy})` : "";
    ctx.logger.info(`  ${r.name.padEnd(10)} ${contractHome(r.path)}${base}${strat}`);
    if (r.run) {
      if (r.run.setup) {
        ctx.logger.info(`    setup:  ${r.run.setup}`);
      }
      ctx.logger.info(`    run:    ${r.run.command}`);
      if (r.run.stopCommand) {
        ctx.logger.info(`    stop:   ${r.run.stopCommand}`);
      }
      if (r.run.port !== undefined || r.run.portEnv) {
        const parts: string[] = [];
        if (r.run.port !== undefined) parts.push(`port=${r.run.port}`);
        if (r.run.portEnv) parts.push(`env=${r.run.portEnv}`);
        ctx.logger.info(`            ${parts.join(", ")}`);
      }
      if (r.run.composePorts && Object.keys(r.run.composePorts).length > 0) {
        ctx.logger.info(`    composePorts:`);
        for (const [k, v] of Object.entries(r.run.composePorts)) {
          ctx.logger.info(`      ${k} ← ${v}`);
        }
      }
    }
    if (r.type === "compose" && r.composeFile) {
      ctx.logger.info(`    compose: ${r.composeFile}`);
    }
    if (r.deployCommand) {
      ctx.logger.info(`    deploy: ${r.deployCommand}`);
    }
  }
}
