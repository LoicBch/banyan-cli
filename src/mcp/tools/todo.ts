/**
 * Per-feature TODO list tools — the agent's own plan it maintains during
 * a task. set/get/update mirror the same trio in api.ts.
 */
import * as api from "../api.js";
import type { ToolDef } from "./types.js";

export const todoTools: ToolDef[] = [
  {
    spec: {
      name: "banyan_set_todo",
      description:
        "Replace the TODO list for a feature with a fresh set of items. Use this at the start of a task to lay out your plan in concrete steps. Each string becomes one TODO item with auto-assigned id (1..N). Resets any prior list.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          items: {
            type: "array",
            items: { type: "string" },
            description: "Ordered list of TODO items, one short sentence each.",
          },
        },
        required: ["project", "feature", "items"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.setFeatureTodo(args.project, args.feature, args.items),
    scopes: ["feature"],
  },
  {
    spec: {
      name: "banyan_get_todo",
      description:
        "Read the current TODO list for a feature. Returns null if no list has been set yet.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) => api.getFeatureTodo(args.project, args.feature),
    scopes: ["feature"],
  },
  {
    spec: {
      name: "banyan_update_todo",
      description:
        "Fine-grained edits to a feature's TODO list. Combine any of the four ops in a single call. Items are referenced by their string id (returned by `banyan_set_todo` / `banyan_get_todo`). New items added via `add` get fresh ids — IDs are never reused.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          feature: { type: "string" },
          add: {
            type: "array",
            items: { type: "string" },
            description: "append these items to the list",
          },
          done: {
            type: "array",
            items: { type: "string" },
            description: "mark these item ids as done",
          },
          undone: {
            type: "array",
            items: { type: "string" },
            description: "mark these item ids as not done (revert)",
          },
          remove: {
            type: "array",
            items: { type: "string" },
            description: "delete these item ids from the list",
          },
        },
        required: ["project", "feature"],
        additionalProperties: false,
      },
    },
    handler: async (args: any) =>
      api.updateFeatureTodo(args.project, args.feature, {
        add: args.add,
        done: args.done,
        undone: args.undone,
        remove: args.remove,
      }),
    scopes: ["feature"],
  },
];
