/**
 * Global keyboard binding hook. Each call registers a key map and listens
 * to keydown on `window` — the cleanup runs on unmount.
 *
 * Suppression rules (do nothing when):
 *  - A modifier is pressed (Cmd / Ctrl / Alt) — we don't shadow native
 *    shortcuts. ⌘K and friends are handled directly in CommandPalette.
 *  - The active element is an input / textarea / contenteditable.
 *  - Any dialog is open (see isAnyDialogOpen) — let the dialog own focus.
 *
 * Multiple components can register handlers without collision; the last
 * registered handler wins per key (insertion order). For Pipeline-like
 * "only when the view is visible" usage, gate via the `enabled` flag.
 */
import * as React from "react";
import { isAnyDialogOpen } from "./imperative-dialog";

export type KeyHandler = (event: KeyboardEvent) => void;
export type KeyMap = Record<string, KeyHandler>;

interface UseKeyboardOptions {
  /** When false the hook is a no-op — useful for view-scoped bindings. */
  enabled?: boolean;
  /** When true, `Shift` is required for the key match (e.g. `?` is
   *  `Shift+/` on most layouts). Default: false (case-insensitive). */
  matchCase?: boolean;
}

export function useKeyboard(map: KeyMap, opts: UseKeyboardOptions = {}): void {
  const { enabled = true, matchCase = false } = opts;
  // Keep the map in a ref so callers can pass inline objects without
  // forcing the handler to re-bind every render.
  const mapRef = React.useRef(map);
  React.useEffect(() => {
    mapRef.current = map;
  }, [map]);

  React.useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isAnyDialogOpen()) return;
      if (isFormElementFocused()) return;

      const key = matchCase ? e.key : e.key.toLowerCase();
      const fn = mapRef.current[key] ?? mapRef.current[e.key];
      if (!fn) return;

      e.preventDefault();
      fn(e);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, matchCase]);
}

/** True when the focused element accepts text input — typing 'j' there
 *  must add the letter, not navigate a list. */
function isFormElementFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el === document.body) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}
