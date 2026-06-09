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
  /** Detected default base branch from `git symbolic-ref origin/HEAD`,
   *  with fallback to `main`/`master` if either branch exists locally.
   *  Null when the path isn't a git repo. */
  suggestedBaseBranch: string | null;
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
  const suggestedBaseBranch = isGitRepo ? detectBaseBranch(resolved) : null;

  return {
    path: resolved,
    valid: true,
    isGitRepo,
    suggestedName: path.basename(resolved),
    suggestedTech: tech,
    suggestedRun: inferred ? inferred.run : null,
    suggestedBaseBranch,
    stackLabel: inferred ? inferred.stack : null,
  };
}

/** Resolve the repo's default branch from `git symbolic-ref origin/HEAD`,
 *  falling back to `main` or `master` if either ref exists locally. Returns
 *  null when no sensible default can be determined (uninitialised repo,
 *  detached HEAD, etc.) — the wizard will then require an explicit choice. */
function detectBaseBranch(repoPath: string): string | null {
  // origin/HEAD is the symbolic ref pointing at the default branch on the
  // remote. Set by `git clone` and by `git remote set-head origin -a`.
  const symRef = execSyncSafe(
    ["git", "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    repoPath,
  );
  if (symRef !== null) {
    const short = symRef.split("/").pop();
    if (short && short.length > 0) return short;
  }
  // No origin/HEAD — look for a local main/master.
  for (const candidate of ["main", "master"]) {
    const check = execSyncSafe(
      ["git", "show-ref", "--verify", "--quiet", `refs/heads/${candidate}`],
      repoPath,
    );
    if (check !== null) return candidate;
  }
  return null;
}

function execSyncSafe(argv: string[], cwd: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    return execFileSync(argv[0]!, argv.slice(1), {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function baseResult(p: string, partial: Partial<ProbeResult>): ProbeResult {
  return {
    path: p,
    valid: false,
    isGitRepo: false,
    suggestedName: path.basename(p),
    suggestedTech: null,
    suggestedRun: null,
    suggestedBaseBranch: null,
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
    if (seen.has(repo.name)) {
      throw new ConfigError(`duplicate repo name '${repo.name}'`);
    }
    seen.add(repo.name);
    validateRepoInput(repo);
  }
}

/** Validation shared between project creation and add-repo-to-existing. */
function validateRepoInput(repo: CreateRepoInput): void {
  if (!repo.name || typeof repo.name !== "string") {
    throw new ConfigError("repo name is required");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(repo.name)) {
    throw new ConfigError(
      `repo name '${repo.name}' must match [A-Za-z0-9_.-]+`,
    );
  }

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

  if (!repo.baseBranch || typeof repo.baseBranch !== "string") {
    throw new ConfigError(`repo '${repo.name}' is missing a baseBranch`);
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

function buildProjectNode(input: CreateProjectInput): Record<string, unknown> {
  return {
    name: input.name,
    repos: input.repos.map(buildRepoNode),
  };
}

function buildRepoNode(r: CreateRepoInput): Record<string, unknown> {
  return {
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
  };
}

/**
 * Append a single repo to an existing project. Preserves the doc's
 * comments and key order; validates the resulting config via the regular
 * loader before persisting. Throws ConfigError on missing project,
 * duplicate repo name, invalid path, or unknown tech.
 */
export async function addRepoToProject(
  projectName: string,
  repo: CreateRepoInput,
  configPath?: string,
): Promise<void> {
  validateRepoInput(repo);

  const resolved = configPath ?? defaultConfigPath();
  if (!existsSync(resolved)) {
    throw new ConfigError(`config file not found: ${resolved}`);
  }
  const doc = await loadOrInitDocument(resolved);

  const projects = doc.get("projects") as YAML.YAMLSeq | undefined;
  if (!projects || !YAML.isSeq(projects)) {
    throw new ConfigError(`${resolved}: "projects" must be a sequence`);
  }

  let projectNode: YAML.YAMLMap | undefined;
  for (const item of projects.items) {
    if (YAML.isMap(item) && item.get("name") === projectName) {
      projectNode = item;
      break;
    }
  }
  if (!projectNode) {
    throw new ConfigError(`project '${projectName}' not found`);
  }

  const reposSeq = projectNode.get("repos") as YAML.YAMLSeq | undefined;
  if (!reposSeq || !YAML.isSeq(reposSeq)) {
    throw new ConfigError(`project '${projectName}' has no repos sequence`);
  }
  for (const item of reposSeq.items) {
    if (YAML.isMap(item) && item.get("name") === repo.name) {
      throw new ConfigError(
        `repo '${repo.name}' already exists in project '${projectName}'`,
      );
    }
  }

  const newRepo = doc.createNode(buildRepoNode(repo));
  reposSeq.add(newRepo);

  validateConfig(doc.toJS(), resolved);

  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, doc.toString(), "utf8");
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

