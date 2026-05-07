import type { Config } from "../config.js";
import { contractHome } from "../config.js";
import { logger } from "../logger.js";

export async function list(config: Config): Promise<void> {
  if (config.projects.length === 0) {
    logger.info("no projects configured. add one with: bn init <project-name>");
    return;
  }
  for (const p of config.projects) {
    logger.info(`${p.name}`);
    for (const r of p.repos) {
      logger.info(`  ${r.name}: ${contractHome(r.path)}`);
    }
    logger.info("");
  }
}
