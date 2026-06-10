/**
 * Per-feature conversation endpoints — render + tail the claude
 * transcript so the dashboard can show a chat view of the agent's
 * session.
 *
 *   GET  /api/conversation/:project/:feature        → last N messages
 *   GET  /api/conversation/:project/:feature/stream → SSE: new messages as
 *                                                      they're appended
 *
 * The dashboard pairs this with the existing `/api/actions/task`
 * (Send message) to give a two-way chat: read here, write there.
 */
import type { Express, Request, Response } from "express";
import {
  findTranscriptFile,
  readMessages,
  watchTranscript,
} from "../conversation.js";
import { rejectUnknownProject, type RouteDeps } from "./shared.js";

const DEFAULT_LIMIT = 50;

export function register(app: Express, deps: RouteDeps): void {
  const { config } = deps;

  app.get(
    "/api/conversation/:project/:feature",
    (req: Request<{ project: string; feature: string }>, res: Response) => {
      const { project, feature } = req.params;
      if (rejectUnknownProject(config, project, res)) return;
      const limit = parseInt((req.query.limit as string) ?? `${DEFAULT_LIMIT}`, 10);
      try {
        const file = findTranscriptFile(config, project, feature);
        if (!file) {
          res.json({ messages: [], transcriptFile: null });
          return;
        }
        const messages = readMessages(file, Number.isFinite(limit) ? limit : DEFAULT_LIMIT);
        res.json({ messages, transcriptFile: file });
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  app.get(
    "/api/conversation/:project/:feature/stream",
    (req: Request<{ project: string; feature: string }>, res: Response) => {
      const { project, feature } = req.params;
      if (rejectUnknownProject(config, project, res)) return;

      const file = findTranscriptFile(config, project, feature);
      if (!file) {
        res.status(404).json({ error: `no transcript found for feature '${feature}'` });
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

      send("hello", { transcriptFile: file });

      const watcher = watchTranscript(file, (newMessages) => {
        send("messages", newMessages);
      });

      // Heartbeat so intermediaries don't close the connection on idle.
      const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
      }, 25_000);

      req.on("close", () => {
        clearInterval(heartbeat);
        watcher.stop();
      });
    },
  );
}
