import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { startServer } from "../dashboard/server.js";
import { ensureToken } from "../dashboard/auth.js";
import { startTunnel, type TunnelProvider } from "../dashboard/tunnel.js";
import { printDashboardQR } from "../dashboard/qr.js";

export interface ServeOpts {
  port?: number;
  open?: boolean;
  /** Expose the dashboard over a public tunnel (cloudflared / ngrok). Implies auth. */
  remote?: boolean;
  /** Pick a specific tunnel provider. Default: auto-detect, prefer cloudflared. */
  tunnel?: TunnelProvider;
  /** Rotate the auth token before starting (invalidates previously-shared QRs). */
  rotateToken?: boolean;
}

export async function serve(config: Config, opts: ServeOpts = {}): Promise<void> {
  const remote = !!opts.remote;
  const token = remote ? ensureToken(!!opts.rotateToken) : "";
  const auth = remote
    ? { enabled: true, token }
    : undefined;

  const { url: localUrl, port } = await startServer(config, {
    port: opts.port,
    // When going remote, never auto-open (the user is going to scan a QR, not
    // alt-tab to a browser).
    open: remote ? false : (opts.open ?? true),
    ...(auth ? { auth } : {}),
  });

  if (!remote) {
    logger.ok(`dashboard running at ${localUrl}`);
    logger.info(`press Ctrl+C to stop`);
    logger.info(``);
    logger.info(`  ${localUrl}/api/state    — raw JSON state`);
    logger.info(`  ${localUrl}/api/health   — liveness probe`);
    await new Promise<void>(() => { /* never resolves */ });
    return;
  }

  // Remote mode: start tunnel, print QR, wait.
  logger.info(`starting tunnel…`);
  let handle;
  try {
    handle = await startTunnel(port, opts.tunnel);
  } catch (err) {
    logger.error(`tunnel failed: ${(err as Error).message}`);
    process.exit(1);
  }
  logger.ok(`tunnel up via ${handle.provider}: ${handle.url}`);
  logger.warn(
    `dashboard is reachable on the public internet. only the token holder can drive banyan.`,
  );
  logger.info(``);
  printDashboardQR(handle.url, token);
  logger.info(`token (also at ~/.config/banyan/state/dashboard.token):`);
  logger.info(`  ${token}`);
  logger.info(``);
  logger.info(`press Ctrl+C to stop the tunnel and the server`);

  const cleanup = () => {
    try { handle?.stop(); } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await new Promise<void>(() => { /* never resolves */ });
}
