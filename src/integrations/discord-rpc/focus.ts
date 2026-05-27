/**
 * Tracks how the Discord Rich Presence service should choose what to display.
 *
 * Two modes:
 *  - "follow" (default): show the project the dashboard is currently scoped
 *    to. The dashboard's project-selector POSTs the project name here, so the
 *    user's Discord profile mirrors what they're looking at in the UI.
 *  - "aggregate": ignore the per-project pin and sum features across every
 *    project with a running session. Project label becomes "All projects".
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");
const FOCUS_FILE = path.join(STATE_DIR, "discord-focus.json");

export type DiscordFocusMode = "follow" | "aggregate";

export interface DiscordFocus {
  mode: DiscordFocusMode;
  project: string | null;
}

const DEFAULT_FOCUS: DiscordFocus = { mode: "follow", project: null };

let cached: DiscordFocus | undefined;

export function getDiscordFocus(): DiscordFocus {
  if (cached !== undefined) return cached;
  cached = readFromDisk();
  return cached;
}

export function setDiscordFocus(patch: Partial<DiscordFocus>): DiscordFocus {
  const current = getDiscordFocus();
  const next: DiscordFocus = {
    mode: patch.mode ?? current.mode,
    project: "project" in patch ? patch.project ?? null : current.project,
  };
  cached = next;
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(FOCUS_FILE, JSON.stringify(next), "utf8");
  } catch (err) {
    console.error("[discord-rpc] Failed to persist focus:", (err as Error).message);
  }
  return next;
}

function readFromDisk(): DiscordFocus {
  if (!existsSync(FOCUS_FILE)) return { ...DEFAULT_FOCUS };
  try {
    const raw = JSON.parse(readFileSync(FOCUS_FILE, "utf8"));
    return {
      mode: raw?.mode === "aggregate" ? "aggregate" : "follow",
      project: typeof raw?.project === "string" ? raw.project : null,
    };
  } catch {
    return { ...DEFAULT_FOCUS };
  }
}
