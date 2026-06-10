/**
 * Token-based auth for the dashboard when running in --remote mode.
 *
 * The backend (src/dashboard/auth.ts) gates every API route behind a
 * Bearer token when `bn serve --remote` is on. The QR code printed in the
 * terminal embeds the token as a URL hash fragment:
 *
 *   https://xxx.trycloudflare.com/#token=<32-hex>
 *
 * On first load we:
 *   1. Read `window.location.hash`, extract the token if present
 *   2. Persist it in localStorage (so reloads keep working)
 *   3. Strip the token from the URL bar (clean address bar, no leak in
 *      screenshots / browser history)
 *
 * Every subsequent fetch goes through `apiFetch` which attaches
 * `Authorization: Bearer <token>` when a token is stored. Localhost-only
 * mode has no token → header is omitted → backend sees no auth gate.
 */

const TOKEN_KEY = "banyan.dashboard.token";

/** Bootstrap step — runs once at app startup before any API call. */
export function bootstrapAuthFromUrl(): void {
  const hash = window.location.hash;
  const m = /[#&]token=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m || !m[1]) return;
  const token = m[1];
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* quota / privacy mode — fall through; token stays in memory only */
  }
  // Strip ?token=… and #token=… from the URL bar so the secret doesn't
  // sit in the address bar or browser history.
  const cleanedHash = hash.replace(/[#&]token=[A-Za-z0-9_-]+/, "").replace(/^#$/, "");
  const cleanedUrl = `${window.location.pathname}${window.location.search}${cleanedHash ? cleanedHash : ""}`;
  window.history.replaceState({}, "", cleanedUrl);
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Wrapper around `fetch` that attaches the Bearer token when one is
 * stored. Drop-in replacement for `fetch` everywhere in the SPA — use
 * this instead of calling `fetch` directly.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();
  if (!token) return fetch(input, init);

  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
