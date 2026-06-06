/**
 * Backend for the "Create project" wizard. Three operations:
 *   1. Browse the local filesystem (directory listing, scoped to $HOME).
 *   2. Probe a candidate path: validate, detect git, run inferRun, suggest a
 *      tech profile.
 *   3. Create a project: append a fresh project block to ~/.config/banyan/
 *      config.yaml, preserving comments via parseDocument.
 *
 * All filesystem operations are local-only — endpoints that wrap them MUST be
 * disabled when the dashboard is exposed via --remote tunnel, since they would
 * otherwise leak directory contents to anyone with the bearer token.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import {
  defaultConfigPath,
  expandHome,
  contractHome,
  validateConfig,
  type RunConfig,
} from "../config.js";
import { ConfigError } from "../errors.js";
import { inferRun } from "../inferRun.js";
import {
  TECH_PROFILES,
  getTechProfile,
  isKnownTech,
  matchStackToProfile,
} from "./techProfiles.js";

// ── Filesystem browser ────────────────────────────────────────────────────

export interface FsEntry {
  name: string;
  isDir: boolean;
  isGitRepo: boolean;
}

export interface FsListResult {
  /** Canonical absolute path that was listed. */
  path: string;
  /** Parent directory (null when at $HOME — we don't go higher). */
  parent: string | null;
  entries: FsEntry[];
}

/**
 * List immediate children of `dir`. Hidden entries are skipped except `.git`-
 * containing directories, which we still mark as git repos.
 *
 * Security: the resolved path MUST stay within $HOME. Any attempt to escape
 * (via `..`, absolute paths outside home, or symlinks pointing outside) throws.
 */
export function listFsEntries(dir: string): FsListResult {
  const home = homedir();
  const expanded = expandHome(dir);
  const resolved = path.resolve(expanded);

  if (!isWithinHome(resolved, home)) {
    throw new ConfigError(`path outside $HOME is not browsable: ${dir}`);
  }
  if (!existsSync(resolved)) {
    throw new ConfigError(`path does not exist: ${dir}`);
  }
  if (!statSync(resolved).isDirectory()) {
    throw new ConfigError(`path is not a directory: ${dir}`);
  }

  let names: string[];
  try {
    names = readdirSync(resolved);
  } catch (err) {
    throw new ConfigError(`cannot read directory: ${(err as Error).message}`);
  }

  const entries: FsEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".") && name !== ".git") continue;
    const full = path.join(resolved, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    entries.push({
      name,
      isDir: true,
      isGitRepo: existsSync(path.join(full, ".git")),
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const parent = resolved === home ? null : path.dirname(resolved);
  return { path: resolved, parent, entries };
}

function isWithinHome(absPath: string, home: string): boolean {
  if (absPath === home) return true;
  return absPath.startsWith(home + path.sep);
}

// ── Path probe ─────────────────────────────────────────────────────────────

export interface ProbeResult {
  /** Canonical absolute path. */
  path: string;
  /** Whether the path passed every basic validation. */
  valid: boolean;
  /** True if `.git` exists at this path (or a parent up to $HOME). */
  isGitRepo: boolean;
  /** Suggested repo name (basename of the path). */
  suggestedName: string;
  /** Best-guess tech profile id, or null when the stack is unrecognised. */
  suggestedTech: string | null;
  /** Best-guess run defaults from inferRun, or null when nothing matched. */
  suggestedRun: Partial<RunConfig> | null;
  /** Human-readable label for the detected stack (e.g. "node + pnpm"). */
  stackLabel: string | null;
  /** Filled when valid=false to explain why. */
  error?: string;
}

/**
 * Inspect a candidate repo path. Surfaces enough info for the wizard to
 * pre-fill the repo form: name, tech profile, run defaults.
 */
export function probePath(input: string): ProbeResult {
  const home = homedir();
  const expanded = expandHome(input);
  const resolved = path.resolve(expanded);

  if (!isWithinHome(resolved, home)) {
    return baseResult(resolved, { valid: false, error: "path is outside $HOME" });
  }
  if (!existsSync(resolved)) {
    return baseResult(resolved, { valid: false, error: "path does not exist" });
  }
  if (!statSync(resolved).isDirectory()) {
    return baseResult(resolved, { valid: false, error: "path is not a directory" });
  }

  const isGitRepo = hasGitDir(resolved);
  const inferred = inferRun(resolved);
  const tech = inferred ? matchStackToProfile(inferred.stack) : null;

  return {
    path: resolved,
    valid: true,
    isGitRepo,
    suggestedName: path.basename(resolved),
    suggestedTech: tech,
    suggestedRun: inferred ? inferred.run : null,
    stackLabel: inferred ? inferred.stack : null,
  };
}

function baseResult(p: string, partial: Partial<ProbeResult>): ProbeResult {
  return {
    path: p,
    valid: false,
    isGitRepo: false,
    suggestedName: path.basename(p),
    suggestedTech: null,
    suggestedRun: null,
    stackLabel: null,
    ...partial,
  };
}

function hasGitDir(p: string): boolean {
  // A worktree's `.git` is a file pointing at the main repo's gitdir, so
  // existsSync alone is enough — we don't need to distinguish.
  if (existsSync(path.join(p, ".git"))) return true;
  // Walk up to $HOME looking for a .git (covers monorepo subdirs).
  const home = homedir();
  let cur = path.dirname(p);
  while (cur.startsWith(home) && cur !== home) {
    if (existsSync(path.join(cur, ".git"))) return true;
    cur = path.dirname(cur);
  }
  return false;
}

// ── Project creation ──────────────────────────────────────────────────────

export interface CreateRepoInput {
  name: string;
  path: string;
  baseBranch?: string;
  tech?: string;
  run?: {
    command: string;
    port?: number;
    portEnv?: string;
    setup?: string;
    stopCommand?: string;
  };
}

export interface CreateProjectInput {
  name: string;
  repos: CreateRepoInput[];
  deployCommand?: string;
}

/**
 * Append a new project to config.yaml. Uses parseDocument so the file's
 * comments and existing key order survive the write. Validates the resulting
 * config with the regular loader before persisting.
 *
 * Throws ConfigError on any validation failure (duplicate name, missing
 * fields, invalid path, unknown tech id).
 */
export async function createProject(
  input: CreateProjectInput,
  configPath?: string,
): Promise<void> {
  validateInput(input);

  const resolved = configPath ?? defaultConfigPath();
  const doc = await loadOrInitDocument(resolved);

  const projects = doc.get("projects") as YAML.YAMLSeq | undefined;
  if (!projects || !YAML.isSeq(projects)) {
    throw new ConfigError(`${resolved}: "projects" must be a sequence`);
  }

  for (const item of projects.items) {
    if (YAML.isMap(item) && item.get("name") === input.name) {
      throw new ConfigError(`project '${input.name}' already exists`);
    }
  }

  const newProject = doc.createNode(buildProjectNode(input));
  projects.add(newProject);

  // Validate via the regular loader before writing — catches any drift between
  // wizard-input and on-disk schema.
  validateConfig(doc.toJS(), resolved);

  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, doc.toString(), "utf8");
}

function validateInput(input: CreateProjectInput): void {
  if (!input.name || typeof input.name !== "string") {
    throw new ConfigError("project name is required");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(input.name)) {
    throw new ConfigError(
      `project name '${input.name}' must match [A-Za-z0-9_.-]+`,
    );
  }
  if (!Array.isArray(input.repos) || input.repos.length === 0) {
    throw new ConfigError("project must declare at least one repo");
  }

  const seen = new Set<string>();
  for (const repo of input.repos) {
    if (!repo.name || typeof repo.name !== "string") {
      throw new ConfigError("repo name is required");
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(repo.name)) {
      throw new ConfigError(
        `repo name '${repo.name}' must match [A-Za-z0-9_.-]+`,
      );
    }
    if (seen.has(repo.name)) {
      throw new ConfigError(`duplicate repo name '${repo.name}'`);
    }
    seen.add(repo.name);

    if (!repo.path || typeof repo.path !== "string") {
      throw new ConfigError(`repo '${repo.name}' is missing a path`);
    }
    const resolvedPath = path.resolve(expandHome(repo.path));
    if (!existsSync(resolvedPath)) {
      throw new ConfigError(`repo '${repo.name}' path does not exist: ${repo.path}`);
    }
    if (!statSync(resolvedPath).isDirectory()) {
      throw new ConfigError(`repo '${repo.name}' path is not a directory: ${repo.path}`);
    }

    if (repo.tech !== undefined && repo.tech !== "" && !isKnownTech(repo.tech)) {
      throw new ConfigError(
        `unknown tech '${repo.tech}' for repo '${repo.name}'. ` +
          `known: ${TECH_PROFILES.map((p) => p.id).join(", ")}`,
      );
    }

    if (repo.run !== undefined) {
      if (!repo.run.command || typeof repo.run.command !== "string") {
        throw new ConfigError(`repo '${repo.name}' run.command is required`);
      }
    }
  }
}

function buildProjectNode(input: CreateProjectInput): Record<string, unknown> {
  return {
    name: input.name,
    ...(input.deployCommand ? { deployCommand: input.deployCommand } : {}),
    repos: input.repos.map((r) => ({
      name: r.name,
      path: contractHome(path.resolve(expandHome(r.path))),
      ...(r.baseBranch ? { baseBranch: r.baseBranch } : {}),
      ...(r.tech ? { tech: r.tech } : {}),
      ...(r.run
        ? {
            run: {
              command: r.run.command,
              ...(r.run.port !== undefined ? { port: r.run.port } : {}),
              ...(r.run.portEnv ? { portEnv: r.run.portEnv } : {}),
              ...(r.run.setup ? { setup: r.run.setup } : {}),
              ...(r.run.stopCommand ? { stopCommand: r.run.stopCommand } : {}),
            },
          }
        : {}),
    })),
  };
}

async function loadOrInitDocument(configPath: string): Promise<YAML.Document.Parsed> {
  if (existsSync(configPath)) {
    const raw = await readFile(configPath, "utf8");
    return YAML.parseDocument(raw);
  }
  // Fresh config — start with the minimum the loader requires.
  const empty = `version: 1\nprojects: []\n`;
  return YAML.parseDocument(empty);
}

// ── Helpers re-exported for the HTTP layer ────────────────────────────────

export { getTechProfile };

/** Snapshot of the profile list returned by GET /api/tech-profiles. */
export function listTechProfiles() {
  return TECH_PROFILES.map((p) => ({
    id: p.id,
    label: p.label,
    hint: p.hint,
    defaults: p.defaults,
  }));
}

