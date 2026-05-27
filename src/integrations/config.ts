/**
 * Load + validate `~/.config/banyan/integrations.yaml`. Returns an empty config
 * (no sources, no rules) when the file is absent — the rest of the system
 * treats that as "integrations disabled" without erroring.
 *
 * Schema is intentionally permissive: unknown source types are kept as-is so
 * we can warn the user without crashing, and rules don't have to match an
 * existing source (warned but tolerated).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { ConfigError } from "../errors.js";
import type { IntegrationsConfig, SourceConfig, IntegrationRule } from "./types.js";

const CONFIG_DIR = path.join(homedir(), ".config", "banyan");
const CONFIG_PATH = path.join(CONFIG_DIR, "integrations.yaml");

export function integrationsConfigPath(): string {
  return CONFIG_PATH;
}

export function loadIntegrationsConfig(): IntegrationsConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { sources: [], rules: [] };
  }
  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    throw new ConfigError(`invalid YAML in ${CONFIG_PATH}: ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== "object") return { sources: [], rules: [] };
  return validate(raw as Record<string, unknown>);
}

function validate(raw: Record<string, unknown>): IntegrationsConfig {
  const sources: SourceConfig[] = [];
  if (Array.isArray(raw.sources)) {
    for (const [i, s] of (raw.sources as unknown[]).entries()) {
      if (!s || typeof s !== "object") {
        throw new ConfigError(`integrations.yaml: sources[${i}] must be a mapping`);
      }
      const o = s as Record<string, unknown>;
      if (typeof o.type !== "string") {
        throw new ConfigError(`integrations.yaml: sources[${i}].type is required`);
      }
      if (typeof o.name !== "string" || o.name.trim() === "") {
        throw new ConfigError(`integrations.yaml: sources[${i}].name is required`);
      }
      const options = (o.options && typeof o.options === "object")
        ? (o.options as Record<string, unknown>)
        : {};
      const intervalRaw = o.pollIntervalMin;
      const pollIntervalMin =
        typeof intervalRaw === "number" && intervalRaw > 0 ? intervalRaw : undefined;
      sources.push({
        type: o.type as SourceConfig["type"],
        name: o.name,
        ...(pollIntervalMin !== undefined ? { pollIntervalMin } : {}),
        options,
      });
    }
  }
  const rules: IntegrationRule[] = [];
  if (Array.isArray(raw.rules)) {
    for (const [i, r] of (raw.rules as unknown[]).entries()) {
      if (!r || typeof r !== "object") {
        throw new ConfigError(`integrations.yaml: rules[${i}] must be a mapping`);
      }
      const o = r as Record<string, unknown>;
      if (typeof o.source !== "string") {
        throw new ConfigError(`integrations.yaml: rules[${i}].source is required`);
      }
      const suggest = (o.suggest && typeof o.suggest === "object")
        ? (o.suggest as Record<string, unknown>)
        : {};
      if (typeof suggest.project !== "string") {
        throw new ConfigError(
          `integrations.yaml: rules[${i}].suggest.project is required`,
        );
      }
      const when = (o.when && typeof o.when === "object")
        ? (o.when as Record<string, unknown>)
        : undefined;
      rules.push({
        source: o.source,
        ...(when ? { when: pickStringArrays(when) } : {}),
        suggest: {
          project: suggest.project,
          ...(typeof suggest.mode === "string" ? { mode: suggest.mode as IntegrationRule["suggest"]["mode"] } : {}),
          ...(typeof suggest.prefix === "string" ? { prefix: suggest.prefix } : {}),
        },
      });
    }
  }
  return { sources, rules };
}

function pickStringArrays(when: Record<string, unknown>): IntegrationRule["when"] {
  const result: NonNullable<IntegrationRule["when"]> = {};
  for (const key of ["assigneesAny", "statusesAny", "tagsAny"] as const) {
    const v = when[key];
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      result[key] = v as string[];
    }
  }
  return result;
}

/**
 * Comment-preserving write back of the integrations config. The dashboard
 * editor sends a structured payload; we serialize via `YAML.stringify` and
 * write it. (Unlike the main config.yaml we don't try to preserve comments
 * here because the integrations file is small and dashboard-managed —
 * round-tripping through a Document would just complicate the contract.)
 */
export async function saveIntegrationsConfig(cfg: IntegrationsConfig): Promise<void> {
  mkdirSync(CONFIG_DIR, { recursive: true });
  // Serialize to a clean YAML, then prepend a short header. Empty sections
  // are still written (as `sources: []`) so the file is always valid.
  const serializable = {
    sources: cfg.sources.map((s) => ({
      type: s.type,
      name: s.name,
      ...(s.pollIntervalMin ? { pollIntervalMin: s.pollIntervalMin } : {}),
      options: s.options,
    })),
    rules: cfg.rules.map((r) => ({
      source: r.source,
      ...(r.when && Object.keys(r.when).length > 0 ? { when: r.when } : {}),
      suggest: {
        project: r.suggest.project,
        ...(r.suggest.mode ? { mode: r.suggest.mode } : {}),
        ...(r.suggest.prefix ? { prefix: r.suggest.prefix } : {}),
      },
    })),
  };
  const body = YAML.stringify(serializable);
  const header = "# banyan integrations — managed by the dashboard.\n# Manual edits are preserved on import but will be overwritten on the next save.\n\n";
  writeFileSync(CONFIG_PATH, header + body, "utf8");
}

/** Create a starter config file with an example commented-out source. Used by
 *  a future `bn integrations init` command. */
export function writeStarterConfig(): string {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const sample = `# Banyan integrations — incoming task ingestion.
# Each source polls an external task manager and adds matching tasks to the
# dashboard inbox. The user reviews and decides whether to spawn an agent.

sources:
  # - type: clickup
  #   name: my-clickup
  #   pollIntervalMin: 5
  #   options:
  #     apiToken: pk_xxx                # ClickUp Personal API token
  #     listId: "901234"                # ClickUp list id (numeric, as string)

rules:
  # - source: my-clickup
  #   when:
  #     assigneesAny: ["loic@park4night.com"]
  #     statusesAny: ["to do", "in progress"]
  #   suggest:
  #     project: park4night
  #     mode: autonomous
`;
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, sample, "utf8");
  }
  return CONFIG_PATH;
}
