/**
 * Remote-access endpoints — expose the tunnel URL + auth token to the
 * dashboard SPA so it can render an in-browser QR code without the user
 * having to look back at the terminal.
 *
 *   GET /api/remote/info     → { enabled, url?, token? }
 *   GET /api/remote/qr.svg   → SVG QR code for `${url}/#token=${token}`
 *                              (404 when remote isn't enabled)
 *
 * Both routes are gated by the same auth middleware as the rest of the
 * API — when remote mode is active, you need the token already. When it
 * isn't, the SPA reaches them over localhost and there's no token check.
 */
import type { Express } from "express";
import QRCode from "qrcode";

export interface RemoteRoutesDeps {
  /** Populated by serve.ts when `--remote` started a tunnel. */
  remote?: { url: string; token: string };
}

export function register(app: Express, deps: RemoteRoutesDeps): void {
  const { remote } = deps;

  app.get("/api/remote/info", (_req, res) => {
    if (!remote) {
      res.json({ enabled: false });
      return;
    }
    res.json({
      enabled: true,
      url: remote.url,
      token: remote.token,
      // Convenience: the exact URL embedded in the QR. Same shape the SPA
      // expects on first load to bootstrap auth from the hash fragment.
      scanUrl: `${remote.url.replace(/\/$/, "")}/#token=${remote.token}`,
    });
  });

  app.get("/api/remote/qr.svg", async (_req, res) => {
    if (!remote) {
      res.status(404).type("text/plain").send("remote mode not enabled");
      return;
    }
    const scanUrl = `${remote.url.replace(/\/$/, "")}/#token=${remote.token}`;
    try {
      const svg = await QRCode.toString(scanUrl, {
        type: "svg",
        // Medium error correction strikes a good balance for a QR that
        // contains a 32-hex token — overhead is small, and lets the code
        // tolerate a bit of camera blur.
        errorCorrectionLevel: "M",
        margin: 1,
        // Banyan emerald against the dashboard's dark surface. Comes out
        // legible on both light and dark Discord themes.
        color: { dark: "#10b981", light: "#0f172a" },
      });
      res.type("image/svg+xml").send(svg);
    } catch (err) {
      res
        .status(500)
        .type("text/plain")
        .send(`qr generation failed: ${(err as Error).message}`);
    }
  });
}
