/**
 * Launch a public tunnel that exposes the local dashboard over HTTPS. Used by
 * `bn serve --remote` so the user can hit banyan from their phone without
 * setting up a VPN.
 *
 * Supported providers (preference order):
 *   - cloudflared (Cloudflare quick tunnel: zero config, random `*.trycloudflare.com`)
 *   - ngrok        (free tier: random `*.ngrok-free.app`)
 *
 * Detection is purely by binary presence on PATH; the user picks which by
 * installing the right tool. They can override with `--tunnel <name>`.
 *
 * Both processes are long-lived: we spawn, parse the URL from stdout/stderr,
 * then hand back a `stop()` so the caller can tear it down on Ctrl-C.
 *
 * IMPORTANT: a public tunnel without auth is dangerous. Callers MUST enable
 * the token auth middleware (`auth.ts`) before binding the tunnel — otherwise
 * anyone with the URL can drive banyan on the user's machine.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { run } from "../exec.js";

export type TunnelProvider = "cloudflared" | "ngrok";

export interface TunnelHandle {
  provider: TunnelProvider;
  url: string;
  /** Stop the underlying process. Idempotent. */
  stop: () => void;
}

export async function detectTunnelProvider(): Promise<TunnelProvider | undefined> {
  for (const p of ["cloudflared", "ngrok"] as const) {
    const r = await run("which", [p], {});
    if (r.code === 0) return p;
  }
  return undefined;
}

export async function startTunnel(
  port: number,
  preferred?: TunnelProvider,
): Promise<TunnelHandle> {
  const provider = preferred ?? (await detectTunnelProvider());
  if (!provider) {
    throw new Error(
      "no tunnel provider found on PATH. install one of:\n" +
        "  - cloudflared:  brew install cloudflared   (recommended — zero config)\n" +
        "  - ngrok:        brew install ngrok",
    );
  }
  if (provider === "cloudflared") return startCloudflared(port);
  return startNgrok(port);
}

function startCloudflared(port: number): Promise<TunnelHandle> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let urlSeen: string | undefined;
    let buf = "";
    const onChunk = (data: Buffer) => {
      buf += data.toString();
      // Cloudflared prints the URL like:
      //   Your quick Tunnel has been created! Visit it at (...)
      //   https://random-words.trycloudflare.com
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !urlSeen) {
        urlSeen = m[0];
        resolve({
          provider: "cloudflared",
          url: urlSeen,
          stop: () => child.kill("SIGTERM"),
        });
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!urlSeen) reject(new Error(`cloudflared exited (${code}) before emitting a URL`));
    });
    // Safety net: if no URL within 20s, bail.
    setTimeout(() => {
      if (!urlSeen) {
        child.kill("SIGTERM");
        reject(new Error("cloudflared did not emit a tunnel URL within 20s"));
      }
    }, 20_000).unref();
  });
}

function startNgrok(port: number): Promise<TunnelHandle> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(
      "ngrok",
      ["http", String(port), "--log=stdout", "--log-format=logfmt"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let urlSeen: string | undefined;
    let buf = "";
    const onChunk = (data: Buffer) => {
      buf += data.toString();
      // ngrok logs lines like `url=https://abcd.ngrok-free.app addr=...`
      const m = buf.match(/url=(https:\/\/[a-z0-9-]+\.ngrok[^\s]+)/);
      if (m && !urlSeen) {
        urlSeen = m[1]!;
        resolve({
          provider: "ngrok",
          url: urlSeen,
          stop: () => child.kill("SIGTERM"),
        });
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!urlSeen) reject(new Error(`ngrok exited (${code}) before emitting a URL`));
    });
    setTimeout(() => {
      if (!urlSeen) {
        child.kill("SIGTERM");
        reject(new Error("ngrok did not emit a tunnel URL within 20s"));
      }
    }, 20_000).unref();
  });
}
