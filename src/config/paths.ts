/**
 * Filesystem path helpers used by the config layer.
 *
 * Kept separate from the loader so other code (e.g. saveConfig in loader,
 * the dashboard's path display) can import path helpers without pulling in
 * YAML parsing or file I/O.
 */
import { homedir } from "node:os";
import path from "node:path";

/** Resolved location of `config.yaml`. Honors `$BANYAN_CONFIG` for tests. */
export function defaultConfigPath(): string {
  return (
    process.env.BANYAN_CONFIG ??
    path.join(homedir(), ".config", "banyan", "config.yaml")
  );
}

/** `~/foo` → `/Users/me/foo`. Plain `~` resolves to $HOME. Other paths
 *  pass through unchanged. */
export function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

/** Inverse of `expandHome` for serialization — `/Users/me/foo` → `~/foo`.
 *  Used by `saveConfig` so the on-disk YAML stays machine-portable. */
export function contractHome(p: string): string {
  const home = homedir();
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return "~" + p.slice(home.length);
  return p;
}
