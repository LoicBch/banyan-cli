import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { startServer } from "../dashboard/server.js";
import { ensureToken } from "../dashboard/auth.js";
import { startTunnel, type TunnelHandle, type TunnelProvider } from "../dashboard/tunnel.js";
import { printDashboardQR } from "../dashboard/qr.js";
import { findFreePort } from "../util/port.js";

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

  // Pre-allocate the listening port so the tunnel and the http server agree
  // on the same number. Otherwise startTunnel would point at 4242 while
  // startServer might fall back to 4243 if 4242 is busy.
  const port = opts.port ?? (await findFreePort(4242));

  // Remote mode: tunnel must be up *before* we expose the URL+token through
  // the dashboard's /api/remote/* routes. We start the tunnel first, then
  // pass its handle into the server's options.
  let handle: TunnelHandle | undefined;
  if (remote) {
    logger.info(`starting tunnel…`);
    try {
      handle = await startTunnel(port, opts.tunnel);
    } catch (err) {
      logger.error(`tunnel failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  const { url: localUrl } = await startServer(config, {
    port,
    // When going remote, never auto-open (the user is going to scan a QR, not
    // alt-tab to a browser).
    open: remote ? false : (opts.open ?? true),
    ...(auth ? { auth } : {}),
    ...(handle ? { remote: { url: handle.url, token } } : {}),
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

  logger.ok(`tunnel up via ${handle!.provider}: ${handle!.url}`);
  logger.warn(
    `dashboard is reachable on the public internet. only the token holder can drive banyan.`,
  );
  logger.info(``);
  printDashboardQR(handle!.url, token);
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
