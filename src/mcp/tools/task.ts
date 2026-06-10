/**
 * Task dispatch — orchestrator pushes a prompt into an existing feature's
 * Claude pane. Single tool here today; future "assign with context" or
 * "queue task" variants would live in this file.
 */
import * as api from "../api.js";
import type { ToolDef } from "./types.js";

export const taskTools: ToolDef[] = [
  {
    spec: {
      name: "banyan_assign_task",
      description:
        "Send a prompt to the Claude agent of an existing feature (paste-and-submit into the feature pane). Use this to dispatch follow-up tasks after `banyan_create_feature`, or to assign work to features that were created without an `initialPrompt`. The feature pane must exist and Claude must be running in it (unless `force` is true).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          prompt: {
            type: "string",
            description: "the message to send to the per-feature agent",
          },
          force: {
            type: "boolean",
            description:
              "send even if Claude isn't detected as running in the pane (default: false). Use only when you know the pane is ready.",
          },
        },
        required: ["project", "feature", "prompt"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.assignTask(args.project, args.feature, args.prompt, { force: args.force }),
    scopes: ["orchestrator"],
  },
];
