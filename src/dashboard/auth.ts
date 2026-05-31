/**
 * Token-based auth for the dashboard. Off by default (localhost-only mode).
 * Turned on by `bn serve --remote`, which exposes the dashboard over a tunnel
 * to the public internet — at that point mutating routes MUST require the
 * Bearer token shared in the QR / link.
 *
 * Storage: `~/.config/banyan/state/dashboard.token` (one line, 32 hex chars).
 * Token survives restarts so the QR you scanned once keeps working.
 * Rotate via `bn serve --remote --rotate-token`.
 *
 * Read-only routes (everything in /api/state, /api/pipeline, /api/reports,
 * etc.) are also gated when auth is enabled — once you publish on the internet,
 * leaking project topology is itself a problem.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");
const TOKEN_PATH = path.join(STATE_DIR, "dashboard.token");

export interface AuthConfig {
  /** When false, no checks are applied (localhost dev mode). */
  enabled: boolean;
  /** The token clients must present. Empty string disables auth. */
  token: string;
}

export function ensureToken(rotate = false): string {
  if (!rotate && existsSync(TOKEN_PATH)) {
    const txt = readFileSync(TOKEN_PATH, "utf8").trim();
    if (txt.length > 0) return txt;
  }
  mkdirSync(STATE_DIR, { recursive: true });
  const fresh = randomBytes(16).toString("hex"); // 32 hex chars
  writeFileSync(TOKEN_PATH, fresh + "\n", { mode: 0o600 });
  return fresh;
}

/**
 * Express middleware factory. When `cfg.enabled`, every request must carry
 * the token via either:
 *   - `Authorization: Bearer <token>` header (preferred for fetch())
 *   - `?token=<token>` query string (acceptable for the very first HTML load
 *     when the SPA can't attach headers yet — the SPA then stashes the token
 *     in localStorage and switches to the header path)
 *
 * The static HTML root (`/`) and `/app.js` are always allowed so the page
 * itself can render the "you need a token" prompt. The SPA bootstraps from
 * `#token=…` in the URL hash before making any API call.
 */
export function authMiddleware(cfg: AuthConfig) {
  return function (req: Request, res: Response, next: NextFunction) {
    if (!cfg.enabled || !cfg.token) {
      next();
      return;
    }
    const url = req.url.split("?")[0]!;
    // Always-public assets (so the SPA shell can render before knowing the
    // token) + the auth-status probe (the SPA polls it to decide whether
    // to show the "paste your token" banner).
    if (
      url === "/" ||
      url === "/index.html" ||
      url === "/app.js" ||
      url === "/api/auth-status" ||
      url.startsWith("/favicon")
    ) {
      next();
      return;
    }

    const header = String(req.headers.authorization || "");
    const headerMatch = /^Bearer\s+(\S+)$/.exec(header);
    const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
    const provided = headerMatch?.[1] ?? queryToken;

    if (!provided || !timingSafeEqual(provided, cfg.token)) {
      res.status(401).json({ error: "unauthorized — missing or invalid token" });
      return;
    }
    next();
  };
}

/** Constant-time string compare to avoid leaking the token via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
