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
  {
    spec: {
      name: "banyan_broadcast_task",
      description:
        "Send the same prompt to every live feature agent in a project, in one call. Use this when many features need to react to the same context — e.g. \"check your TODOs\", \"scope was clarified, here's the new spec\", \"pause and report\". Skips reserved panes (ops / orchestrator / terminal) automatically. Returns the list of features that received the prompt and those skipped (with reason).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          prompt: {
            type: "string",
            description: "the message to send to every per-feature agent",
          },
          only: {
            type: "array",
            items: { type: "string" },
            description: "optional whitelist of feature tags to target (intersection)",
          },
          exclude: {
            type: "array",
            items: { type: "string" },
            description: "optional blacklist of feature tags to skip",
          },
          force: {
            type: "boolean",
            description:
              "send even to panes where Claude isn't detected as running (default: false — those panes are skipped with reason \"claude not running\")",
          },
        },
        required: ["project", "prompt"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.broadcastTask(args.project, args.prompt, {
        only: args.only,
        exclude: args.exclude,
        force: args.force,
      }),
    scopes: ["orchestrator"],
  },
];
