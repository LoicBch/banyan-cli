/**
 * Transcript search tool — the orchestrator uses this to grep what
 * sub-agents have written across the project's claude conversation
 * history. Subsumes the use case the old `bn ask` engine covered.
 */
import * as api from "../api.js";
import type { ToolDef } from "./types.js";

export const searchTools: ToolDef[] = [
  {
    spec: {
      name: "banyan_search_transcripts",
      description:
        "Grep the project's claude conversation transcripts for keywords. " +
        "Scans every sub-agent's history under ~/.claude/projects/<encoded-cwd>/ " +
        "(the main checkout + every worktree's transcripts) and returns excerpts " +
        "around keyword hits, scored by number of distinct keywords matched. " +
        "Useful when the user asks 'why did we decide X?' / 'what was the hesitation on Y?' " +
        "— the answer is often buried in a past sub-agent conversation.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          query: {
            type: "string",
            description: "The user's question / search terms. Stop-words are stripped automatically.",
          },
          feature: {
            type: "string",
            description: "Optional. Limit to transcripts that mention this feature name.",
          },
          limit: {
            type: "number",
            description: "Max excerpts to return. Default: 20.",
          },
        },
        required: ["project", "query"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.searchTranscripts(args.project, args.query, {
        ...(args.feature ? { feature: args.feature } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      }),
    scopes: ["orchestrator"],
  },
];
