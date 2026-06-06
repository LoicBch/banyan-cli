/**
 * Tmux key-binding editor — read current bindings + write new ones.
 *
 * Storage + tmux conf rendering live in `../shortcuts.ts`; this file is
 * just the HTTP shell.
 */
import type { Express } from "express";
import {
  ACTIONS as SHORTCUT_ACTIONS,
  readBindings,
  writeBindings,
  defaultBindings,
} from "../shortcuts.js";

export function register(app: Express): void {
  app.get("/api/shortcuts", (_req, res) => {
    try {
      const { bindings, configPath, tmuxConfPath } = readBindings();
      res.json({
        actions: SHORTCUT_ACTIONS,
        bindings,
        defaults: defaultBindings(),
        configPath,
        tmuxConfPath,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/api/shortcuts", async (req, res) => {
    const body = (req.body ?? {}) as { bindings?: Record<string, string> };
    if (!body.bindings || typeof body.bindings !== "object") {
      res.status(400).json({ ok: false, error: "missing bindings" });
      return;
    }
    try {
      const r = await writeBindings(body.bindings);
      res.status(r.ok ? 200 : 400).json(r);
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });
}
