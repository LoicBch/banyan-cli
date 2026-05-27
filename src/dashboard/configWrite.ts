/**
 * Comment-preserving updates to ~/.config/banyan/config.yaml from the dashboard.
 *
 * We use `YAML.parseDocument` (not `YAML.parse`) so that round-trip writes keep
 * the user's comments and key order. The Document is mutated in place with
 * `setIn` / `removeIn`, validated via the normal config loader, then stringified.
 *
 * Failures (validation error, missing project/repo) bubble up as `ConfigError`.
 */
import { readFile, writeFile } from "node:fs/promises";
import YAML from "yaml";
import {
  defaultConfigPath,
  validateConfig,
  type RunConfig,
} from "../config.js";
import { ConfigError } from "../errors.js";

/** Payload accepted by `updateRepoRun`. Only the fields editable from the
 *  Config tab — port/portEnv/env/composePorts stay file-managed for now. */
export interface RepoRunUpdate {
  command: string;
  setup?: string;
  stopCommand?: string;
  presets?: Record<string, string>;
  activePreset?: string;
}

export async function readConfigRaw(configPath?: string): Promise<{ raw: string; path: string }> {
  const resolved = configPath ?? defaultConfigPath();
  const raw = await readFile(resolved, "utf8");
  return { raw, path: resolved };
}

/**
 * Update one repo's `run` block. Walks the YAML Document, mutates the
 * targeted node, validates the resulting structure with the regular config
 * loader, then writes back. Comments and unrelated fields are preserved.
 */
export async function updateRepoRun(
  projectName: string,
  repoName: string,
  update: RepoRunUpdate,
  configPath?: string,
): Promise<void> {
  const { raw, path: resolved } = await readConfigRaw(configPath);

  const doc = YAML.parseDocument(raw);
  const projects = doc.get("projects") as YAML.YAMLSeq | undefined;
  if (!projects || !YAML.isSeq(projects)) {
    throw new ConfigError(`${resolved}: "projects" must be a sequence`);
  }

  let projectIdx = -1;
  let repoIdx = -1;
  for (let i = 0; i < projects.items.length; i++) {
    const p = projects.items[i] as YAML.YAMLMap | undefined;
    if (!p || !YAML.isMap(p)) continue;
    if (p.get("name") !== projectName) continue;
    projectIdx = i;
    const repos = p.get("repos") as YAML.YAMLSeq | undefined;
    if (!repos || !YAML.isSeq(repos)) {
      throw new ConfigError(`${resolved}: projects[${i}].repos must be a sequence`);
    }
    for (let j = 0; j < repos.items.length; j++) {
      const r = repos.items[j] as YAML.YAMLMap | undefined;
      if (!r || !YAML.isMap(r)) continue;
      if (r.get("name") === repoName) {
        repoIdx = j;
        break;
      }
    }
    break;
  }

  if (projectIdx < 0) throw new ConfigError(`unknown project '${projectName}'`);
  if (repoIdx < 0) throw new ConfigError(`unknown repo '${repoName}' in project '${projectName}'`);

  const runPath = ["projects", projectIdx, "repos", repoIdx, "run"] as const;

  // command — always required.
  doc.setIn([...runPath, "command"], update.command);

  // setup / stopCommand — set or remove based on emptiness.
  setOrRemove(doc, [...runPath, "setup"], update.setup);
  setOrRemove(doc, [...runPath, "stopCommand"], update.stopCommand);

  // presets — replace the whole map (or remove if empty).
  if (update.presets && Object.keys(update.presets).length > 0) {
    // Build a YAMLMap so we get a clean ordered output without inherited
    // anchors from a previous shape.
    const map = doc.createNode(update.presets) as YAML.YAMLMap;
    doc.setIn([...runPath, "presets"], map);
  } else {
    doc.deleteIn([...runPath, "presets"]);
  }

  // activePreset — keep only if non-empty and present in presets.
  if (
    update.activePreset &&
    update.presets &&
    update.activePreset in update.presets
  ) {
    doc.setIn([...runPath, "activePreset"], update.activePreset);
  } else {
    doc.deleteIn([...runPath, "activePreset"]);
  }

  // Validate via the normal loader to catch typos / inconsistencies before
  // we write to disk.
  validateConfig(doc.toJS(), resolved);

  await writeFile(resolved, doc.toString(), "utf8");
}

function setOrRemove(
  doc: YAML.Document.Parsed,
  path: readonly (string | number)[],
  value: string | undefined,
): void {
  if (value !== undefined && value !== "") {
    doc.setIn(path, value);
  } else {
    doc.deleteIn(path);
  }
}

/** Read the full config as plain JS (validated) — used by GET /api/config. */
export async function readConfigForDashboard(configPath?: string) {
  const resolved = configPath ?? defaultConfigPath();
  const raw = await readFile(resolved, "utf8");
  const parsed = YAML.parse(raw);
  return validateConfig(parsed, resolved);
}

/** Type-safe re-export to keep the API surface tight. */
export type { RunConfig };
