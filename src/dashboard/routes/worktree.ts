/**
 * Generic worktree creation from the dashboard — mobile-friendly endpoint
 * used by both the "+ new feature" dialog and the Cmd+K palette.
 *
 * Three name-resolution paths:
 *   1. Explicit `feature` in the body — use it as-is.
 *   2. No feature + `initialPrompt` given — LLM-infer the slug from the
 *      prompt (matches the CLI's `bn wt -p` shortcut).
 *   3. No feature, no prompt — create a draft worktree; the agent will
 *      call `banyan_finalize_feature_name` after the first user message.
 *
 * When `openTerminal` is set + we're in local mode, after the worktree
 * is spawned we also pop a native terminal window already running
 * `bn <project> start` so the user sees the agent live without manual
 * attach.
 *
 * The integrations-spawn endpoint also creates worktrees but with extra
 * lifecycle (markSpawned, etc.) — it lives in `integrations.ts`.
 */
import type { Express } from "express";
import { wtAll } from "../../commands/wtAll.js";
import { openTerminalWindow } from "../terminalLauncher.js";
import { sessionName } from "../../naming.js";
import { requireFields, type RouteDeps } from "./shared.js";

interface WtRouteDeps extends RouteDeps {
  /** True in local mode — gates the "open native terminal" side-effect.
   *  In `--remote` tunnel mode the server can't usefully spawn a window
   *  on the user's phone, so we silently skip. */
  filesystemRoutesEnabled: boolean;
}

export function register(app: Express, deps: WtRouteDeps): void {
  const { config, filesystemRoutesEnabled } = deps;

  app.post("/api/wt", async (req, res) => {
    if (!requireFields(req, res, ["project"])) return;
    const body = (req.body ?? {}) as {
      project: string;
      feature?: string;
      repos?: string[];
      initialPrompt?: string;
      /** Accepts `live` / `delegated`, or any legacy 4-mode value —
       *  normalized at the agentPrompt boundary. */
      mode?: string;
      prefix?: string;
      requireApproval?: boolean;
      openTerminal?: boolean;
    };
    if (!config.projects.some((p) => p.name === body.project)) {
      res.status(404).json({ ok: false, error: `unknown project '${body.project}'` });
      return;
    }
    try {
      let featureName = body.feature?.trim();
      let inferredFromPrompt = false;
      if (!featureName) {
        if (body.initialPrompt && body.initialPrompt.trim().length > 0) {
          const { generateSlug } = await import("../../slug.js");
          featureName = await generateSlug(body.initialPrompt);
          inferredFromPrompt = true;
        } else {
          const { generateDraftFeature } = await import("../../naming.js");
          featureName = generateDraftFeature();
        }
      }
      const { normalizeMode } = await import("../../agentPrompt.js");
      const normalizedMode = normalizeMode(body.mode);
      await wtAll(config, body.project, featureName, {
        ...(body.repos && body.repos.length > 0 ? { only: body.repos } : {}),
        ...(body.initialPrompt ? { initialPrompt: body.initialPrompt } : {}),
        ...(body.prefix !== undefined ? { prefix: body.prefix } : {}),
        ...(normalizedMode ? { mode: normalizedMode } : {}),
        ...(body.requireApproval ? { requireApproval: true } : {}),
      });

      // Best-effort terminal attach. Local-mode only; failures don't
      // un-do the spawn — they just surface in the response payload so
      // the dashboard can toast accordingly. If a tmux client is already
      // attached to the session, the launcher activates the terminal app
      // instead of opening a redundant second window.
      let terminalOpened = false;
      let terminalAttachedToExisting = false;
      let terminalError: string | undefined;
      if (body.openTerminal && filesystemRoutesEnabled) {
        const r = await openTerminalWindow({
          command: `bn ${body.project} start`,
          existingTmuxSession: sessionName(body.project),
        });
        terminalOpened = r.ok;
        terminalAttachedToExisting = !!r.attachedToExisting;
        if (!r.ok) terminalError = r.error;
      }

      res.json({
        ok: true,
        feature: featureName,
        draft: !body.feature && !inferredFromPrompt,
        inferredFromPrompt,
        terminalOpened,
        terminalAttachedToExisting,
        ...(terminalError ? { terminalError } : {}),
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // Standalone terminal-attach for already-spawned features. Same path as
  // the post-create attach above, but invoked from a button on existing
  // feature cards in the Pipeline drill-down.
  app.post("/api/terminal/open", async (req, res) => {
    if (!filesystemRoutesEnabled) {
      res.status(403).json({ ok: false, error: "terminal launch is disabled in remote mode" });
      return;
    }
    if (!requireFields(req, res, ["project"])) return;
    const { project } = req.body as { project: string };
    if (!config.projects.some((p) => p.name === project)) {
      res.status(404).json({ ok: false, error: `unknown project '${project}'` });
      return;
    }
    const r = await openTerminalWindow({
      command: `bn ${project} start`,
      existingTmuxSession: sessionName(project),
    });
    if (r.ok) res.json({ ok: true, terminal: r.terminal, attachedToExisting: !!r.attachedToExisting });
    else res.status(500).json({ ok: false, error: r.error });
  });
}
