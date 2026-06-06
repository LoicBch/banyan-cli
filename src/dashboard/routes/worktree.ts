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
 * The integrations-spawn endpoint also creates worktrees but with extra
 * lifecycle (markSpawned, etc.) — it lives in `integrations.ts`.
 */
import type { Express } from "express";
import { wtAll } from "../../commands/wtAll.js";
import { requireFields, type RouteDeps } from "./shared.js";

export function register(app: Express, deps: RouteDeps): void {
  const { config } = deps;

  app.post("/api/wt", async (req, res) => {
    if (!requireFields(req, res, ["project"])) return;
    const body = (req.body ?? {}) as {
      project: string;
      feature?: string;
      repos?: string[];
      initialPrompt?: string;
      mode?: "interactive" | "assisted" | "autonomous" | "autopilot";
      prefix?: string;
      requireApproval?: boolean;
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
      await wtAll(config, body.project, featureName, {
        ...(body.repos && body.repos.length > 0 ? { only: body.repos } : {}),
        ...(body.initialPrompt ? { initialPrompt: body.initialPrompt } : {}),
        ...(body.prefix !== undefined ? { prefix: body.prefix } : {}),
        ...(body.mode ? { mode: body.mode } : {}),
        ...(body.requireApproval ? { requireApproval: true } : {}),
      });
      res.json({
        ok: true,
        feature: featureName,
        draft: !body.feature && !inferredFromPrompt,
        inferredFromPrompt,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });
}
