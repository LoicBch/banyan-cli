/**
 * `bn ask` endpoints — chat-style question + history.
 *
 * POST /api/ask/:project streams Claude's response via SSE. The frame
 * format is documented inline; the SPA's Ask view consumes it via fetch +
 * ReadableStream (EventSource doesn't support POST bodies).
 *
 * GET /api/ask/:project/history returns past Q&A, newest first.
 */
import type { Express, Request, Response } from "express";
import { ask as askEngine, readAskHistory } from "../../ask/index.js";
import { rejectUnknownProject, type RouteDeps } from "./shared.js";

export function register(app: Express, deps: RouteDeps): void {
  const { config } = deps;

  // Streamed Q&A via SSE.
  app.post(
    "/api/ask/:project",
    async (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      if (rejectUnknownProject(config, projectName, res)) return;

      const body = (req.body ?? {}) as {
        question?: string;
        feature?: string;
        days?: number;
        includeTranscripts?: boolean;
        model?: string;
      };
      const question = (body.question ?? "").trim();
      if (!question) {
        res.status(400).json({ ok: false, error: "question is required" });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const send = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const askOpts = {
          ...(body.feature ? { feature: body.feature } : {}),
          ...(body.days !== undefined ? { daysOfCommits: body.days } : {}),
          ...(body.includeTranscripts === false ? { includeTranscripts: false } : {}),
          ...(body.model ? { model: body.model } : {}),
        };
        const record = await askEngine(config, projectName, question, askOpts, (chunk) => {
          send("chunk", { text: chunk });
        });
        send("done", { record });
        res.end();
      } catch (err) {
        send("error", { message: (err as Error).message });
        res.end();
      }
    },
  );

  // Past Q&A history.
  app.get(
    "/api/ask/:project/history",
    (req: Request<{ project: string }>, res: Response) => {
      const projectName = req.params.project;
      if (rejectUnknownProject(config, projectName, res)) return;
      try {
        const limit = parseInt(String(req.query.limit ?? "50"), 10) || 50;
        res.json({ records: readAskHistory(projectName, limit) });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );
}
