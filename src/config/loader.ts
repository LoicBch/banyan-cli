/**
 * Read/write the on-disk config.yaml.
 *
 * `loadConfig` reads + parses YAML and runs the validator. `saveConfig`
 * serialises a normalized projection (only documented fields, ~/ for paths)
 * so the written file stays minimal and portable.
 *
 * Comment-preserving updates live in `dashboard/configWrite.ts` — this
 * loader is for full-file reads and bootstrap writes.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ConfigError } from "../errors.js";
import { contractHome, defaultConfigPath } from "./paths.js";
import { validateConfig } from "./validation.js";
import type { Config } from "./types.js";

export async function loadConfig(configPath?: string): Promise<Config> {
  const resolved = configPath ?? defaultConfigPath();
  if (!existsSync(resolved)) {
    throw new ConfigError(
      `config file not found: ${resolved}\n` +
        `create one with: bn init <project-name>`,
    );
  }
  let raw: string;
  try {
    raw = await readFile(resolved, "utf8");
  } catch (err) {
    throw new ConfigError(`cannot read config: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    throw new ConfigError(`invalid YAML in ${resolved}: ${(err as Error).message}`);
  }

  return validateConfig(parsed, resolved);
}

export async function saveConfig(cfg: Config, configPath?: string): Promise<void> {
  const resolved = configPath ?? defaultConfigPath();
  await mkdir(path.dirname(resolved), { recursive: true });
  const serializable = {
    version: cfg.version,
    projects: cfg.projects.map((p) => ({
      name: p.name,
      ...(p.deployCommand ? { deployCommand: p.deployCommand } : {}),
      repos: p.repos.map((r) => ({
        name: r.name,
        ...(r.type && r.type !== "git" ? { type: r.type } : {}),
        path: contractHome(r.path),
        ...(r.baseBranch ? { baseBranch: r.baseBranch } : {}),
        ...(r.mergeStrategy ? { mergeStrategy: r.mergeStrategy } : {}),
        ...(r.tech ? { tech: r.tech } : {}),
        ...(r.copyOnWorktree && r.copyOnWorktree.length > 0
          ? { copyOnWorktree: r.copyOnWorktree }
          : {}),
        ...(r.loadEnvFiles && r.loadEnvFiles.length > 0
          ? { loadEnvFiles: r.loadEnvFiles }
          : {}),
        ...(r.run
          ? {
              run: {
                command: r.run.command,
                ...(r.run.presets && Object.keys(r.run.presets).length > 0
                  ? { presets: r.run.presets }
                  : {}),
                ...(r.run.activePreset ? { activePreset: r.run.activePreset } : {}),
                ...(r.run.port !== undefined ? { port: r.run.port } : {}),
                ...(r.run.portEnv ? { portEnv: r.run.portEnv } : {}),
                ...(r.run.setup ? { setup: r.run.setup } : {}),
                ...(r.run.stopCommand ? { stopCommand: r.run.stopCommand } : {}),
                ...(r.run.env && Object.keys(r.run.env).length > 0
                  ? { env: r.run.env }
                  : {}),
                ...(r.run.composePorts && Object.keys(r.run.composePorts).length > 0
                  ? { composePorts: r.run.composePorts }
                  : {}),
              },
            }
          : {}),
        ...(r.deployCommand ? { deployCommand: r.deployCommand } : {}),
        ...(r.composeFile ? { composeFile: r.composeFile } : {}),
      })),
    })),
  };
  const yaml = YAML.stringify(serializable);
  await writeFile(resolved, yaml, "utf8");
}
