/**
 * Persistent runtime state for banyan features.
 *
 * Records port allocations done at `bn start <feature>` time so that later
 * commands (`bn ports`) can show what's currently in use without re-running
 * the start logic. Compose ports are NOT stored here — they're queryable
 * live via `docker port` against the running stack.
 *
 * Layout: ~/.config/banyan/state/<project>.<feature>.json
 *
 * Best-effort: state is rewritten on every `bn start` and may go stale if
 * processes are killed externally or the user runs commands by hand. Treat
 * it as a hint, not a source of truth.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");

export interface FeatureRuntimeState {
  project: string;
  feature: string;
  lastStartedAt: string;
  repos: Record<
    string,
    {
      port: number;
      portEnv: string;
      canonicalPort: number;
    }
  >;
}

function statePath(project: string, feature: string): string {
  return path.join(STATE_DIR, `${project}.${feature}.json`);
}

export function writeFeatureState(state: FeatureRuntimeState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(statePath(state.project, state.feature), JSON.stringify(state, null, 2), "utf8");
}

export function readFeatureState(
  project: string,
  feature: string,
): FeatureRuntimeState | undefined {
  const p = statePath(project, feature);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as FeatureRuntimeState;
  } catch {
    return undefined;
  }
}

export function deleteFeatureState(project: string, feature: string): void {
  const p = statePath(project, feature);
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      // ignore
    }
  }
}

/** List all features that have a recorded state for a project. */
export function listFeatureStates(project: string): string[] {
  if (!existsSync(STATE_DIR)) return [];
  const prefix = `${project}.`;
  const features: string[] = [];
  for (const f of readdirSync(STATE_DIR)) {
    if (!f.startsWith(prefix) || !f.endsWith(".json")) continue;
    features.push(f.slice(prefix.length, -".json".length));
  }
  return features;
}
