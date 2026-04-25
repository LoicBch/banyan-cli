import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { startServer } from "../dashboard/server.js";

export interface ServeOpts {
  port?: number;
  open?: boolean;
}

export async function serve(config: Config, opts: ServeOpts = {}): Promise<void> {
  const { port, url } = await startServer(config, {
    port: opts.port,
    open: opts.open ?? true,
  });
  logger.ok(`dashboard running at ${url}`);
  logger.info(`press Ctrl+C to stop`);
  logger.info(``);
  logger.info(`  ${url}/api/state    — raw JSON state`);
  logger.info(`  ${url}/api/health   — liveness probe`);

  // Keep process alive
  await new Promise<void>(() => {
    // never resolves
  });
}
