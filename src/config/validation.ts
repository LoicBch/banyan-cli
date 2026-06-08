/**
 * Config validation + lookups.
 *
 * `validateConfig` walks raw parsed YAML and asserts every field, returning
 * a strongly-typed Config. It's the single source of truth for what the
 * schema accepts — extend here when adding a new field.
 *
 * The lookups (`getProject`, `getRepo`, `resolveCurrentProject`) live with
 * validation because they share the same "throw a useful error when the
 * data isn't what we expect" philosophy.
 */
import path from "node:path";
import { ConfigError } from "../errors.js";
import { expandHome } from "./paths.js";
import type {
  Config,
  ProjectConfig,
  RepoConfig,
  RepoType,
  RunConfig,
} from "./types.js";

export function validateConfig(raw: unknown, sourcePath: string): Config {
  if (!isObject(raw)) {
    throw new ConfigError(`${sourcePath}: root must be a mapping`);
  }
  if (raw.version !== 1) {
    throw new ConfigError(
      `${sourcePath}: unsupported version ${String(raw.version)}, expected 1`,
    );
  }
  if (!Array.isArray(raw.projects)) {
    throw new ConfigError(`${sourcePath}: "projects" must be a list`);
  }

  const projects: ProjectConfig[] = [];
  const seenProjects = new Set<string>();

  for (const [i, p] of (raw.projects as unknown[]).entries()) {
    if (!isObject(p)) {
      throw new ConfigError(`${sourcePath}: projects[${i}] must be a mapping`);
    }
    const name = requireString(p, "name", `projects[${i}]`, sourcePath);
    if (seenProjects.has(name)) {
      throw new ConfigError(`${sourcePath}: duplicate project name "${name}"`);
    }
    seenProjects.add(name);

    if (!Array.isArray(p.repos) || p.repos.length === 0) {
      throw new ConfigError(
        `${sourcePath}: projects[${i}] (${name}) must have a non-empty "repos" list`,
      );
    }

    const repos: RepoConfig[] = [];
    const seenRepos = new Set<string>();
    for (const [j, r] of (p.repos as unknown[]).entries()) {
      if (!isObject(r)) {
        throw new ConfigError(
          `${sourcePath}: projects[${i}].repos[${j}] must be a mapping`,
        );
      }
      const rName = requireString(
        r,
        "name",
        `projects[${i}].repos[${j}]`,
        sourcePath,
      );
      if (seenRepos.has(rName)) {
        throw new ConfigError(
          `${sourcePath}: duplicate repo "${rName}" in project "${name}"`,
        );
      }
      seenRepos.add(rName);
      const rPath = expandHome(
        requireString(r, "path", `projects[${i}].repos[${j}]`, sourcePath),
      );
      let baseBranch: string | undefined;
      if (r.baseBranch !== undefined && r.baseBranch !== null && r.baseBranch !== "") {
        if (typeof r.baseBranch !== "string") {
          throw new ConfigError(
            `${sourcePath}: projects[${i}].repos[${j}].baseBranch must be a string`,
          );
        }
        baseBranch = r.baseBranch;
      }

      let mergeStrategy: RepoConfig["mergeStrategy"];
      if (r.mergeStrategy !== undefined && r.mergeStrategy !== null && r.mergeStrategy !== "") {
        if (typeof r.mergeStrategy !== "string" || !["squash", "merge", "rebase"].includes(r.mergeStrategy)) {
          throw new ConfigError(
            `${sourcePath}: projects[${i}].repos[${j}].mergeStrategy must be one of: squash, merge, rebase`,
          );
        }
        mergeStrategy = r.mergeStrategy as RepoConfig["mergeStrategy"];
      }

      let tech: string | undefined;
      if (r.tech !== undefined && r.tech !== null && r.tech !== "") {
        if (typeof r.tech !== "string") {
          throw new ConfigError(
            `${sourcePath}: projects[${i}].repos[${j}].tech must be a string`,
          );
        }
        tech = r.tech;
      }

      const validateRelPaths = (
        rawList: unknown,
        fieldName: "copyOnWorktree" | "loadEnvFiles",
      ): string[] | undefined => {
        if (rawList === undefined || rawList === null) return undefined;
        if (!Array.isArray(rawList)) {
          throw new ConfigError(
            `${sourcePath}: projects[${i}].repos[${j}].${fieldName} must be a list of strings`,
          );
        }
        const cleaned: string[] = [];
        for (const [k, entry] of rawList.entries()) {
          if (typeof entry !== "string" || entry === "") {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].${fieldName}[${k}] must be a non-empty string`,
            );
          }
          if (path.isAbsolute(entry) || entry.split(/[\\/]/).includes("..")) {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].${fieldName}[${k}] '${entry}' must be a relative path without '..'`,
            );
          }
          cleaned.push(entry);
        }
        return cleaned.length > 0 ? cleaned : undefined;
      };

      const copyOnWorktree = validateRelPaths(r.copyOnWorktree, "copyOnWorktree");
      const loadEnvFiles = validateRelPaths(r.loadEnvFiles, "loadEnvFiles");

      let run: RunConfig | undefined;
      if (r.run !== undefined && r.run !== null) {
        if (!isObject(r.run)) {
          throw new ConfigError(
            `${sourcePath}: projects[${i}].repos[${j}].run must be a mapping`,
          );
        }
        const runObj = r.run;
        const command = requireString(
          runObj,
          "command",
          `projects[${i}].repos[${j}].run`,
          sourcePath,
        );
        let port: number | undefined;
        if (runObj.port !== undefined && runObj.port !== null) {
          if (typeof runObj.port !== "number" || !Number.isInteger(runObj.port)) {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].run.port must be an integer`,
            );
          }
          port = runObj.port;
        }
        let portEnv: string | undefined;
        if (runObj.portEnv !== undefined && runObj.portEnv !== null && runObj.portEnv !== "") {
          if (typeof runObj.portEnv !== "string") {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].run.portEnv must be a string`,
            );
          }
          portEnv = runObj.portEnv;
        }
        let setup: string | undefined;
        if (runObj.setup !== undefined && runObj.setup !== null && runObj.setup !== "") {
          if (typeof runObj.setup !== "string") {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].run.setup must be a string`,
            );
          }
          setup = runObj.setup;
        }
        let stopCommand: string | undefined;
        if (
          runObj.stopCommand !== undefined &&
          runObj.stopCommand !== null &&
          runObj.stopCommand !== ""
        ) {
          if (typeof runObj.stopCommand !== "string") {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].run.stopCommand must be a string`,
            );
          }
          stopCommand = runObj.stopCommand;
        }
        let envMap: Record<string, string> | undefined;
        if (runObj.env !== undefined && runObj.env !== null) {
          if (!isObject(runObj.env)) {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].run.env must be a mapping`,
            );
          }
          envMap = {};
          for (const [k, v] of Object.entries(runObj.env)) {
            if (typeof v !== "string") {
              throw new ConfigError(
                `${sourcePath}: projects[${i}].repos[${j}].run.env.${k} must be a string`,
              );
            }
            envMap[k] = v;
          }
        }
        let composePorts: Record<string, string> | undefined;
        if (runObj.composePorts !== undefined && runObj.composePorts !== null) {
          if (!isObject(runObj.composePorts)) {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].run.composePorts must be a mapping`,
            );
          }
          composePorts = {};
          for (const [k, v] of Object.entries(runObj.composePorts)) {
            if (typeof v !== "string" || !/^[\w.-]+:\d+$/.test(v)) {
              throw new ConfigError(
                `${sourcePath}: projects[${i}].repos[${j}].run.composePorts.${k} must be "<service>:<port>"`,
              );
            }
            composePorts[k] = v;
          }
        }
        let presets: Record<string, string> | undefined;
        if (runObj.presets !== undefined && runObj.presets !== null) {
          if (!isObject(runObj.presets)) {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].run.presets must be a mapping`,
            );
          }
          presets = {};
          for (const [k, v] of Object.entries(runObj.presets)) {
            if (typeof v !== "string" || v === "") {
              throw new ConfigError(
                `${sourcePath}: projects[${i}].repos[${j}].run.presets.${k} must be a non-empty string`,
              );
            }
            if (!/^[\w.-]+$/.test(k)) {
              throw new ConfigError(
                `${sourcePath}: projects[${i}].repos[${j}].run.presets: preset name '${k}' must match [A-Za-z0-9_.-]+`,
              );
            }
            presets[k] = v;
          }
        }
        let activePreset: string | undefined;
        if (
          runObj.activePreset !== undefined &&
          runObj.activePreset !== null &&
          runObj.activePreset !== ""
        ) {
          if (typeof runObj.activePreset !== "string") {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].run.activePreset must be a string`,
            );
          }
          if (!presets || !(runObj.activePreset in presets)) {
            throw new ConfigError(
              `${sourcePath}: projects[${i}].repos[${j}].run.activePreset '${runObj.activePreset}' is not in run.presets`,
            );
          }
          activePreset = runObj.activePreset;
        }
        run = {
          command,
          ...(presets && Object.keys(presets).length > 0 ? { presets } : {}),
          ...(activePreset ? { activePreset } : {}),
          ...(port !== undefined ? { port } : {}),
          ...(portEnv ? { portEnv } : {}),
          ...(setup ? { setup } : {}),
          ...(stopCommand ? { stopCommand } : {}),
          ...(envMap && Object.keys(envMap).length > 0 ? { env: envMap } : {}),
          ...(composePorts && Object.keys(composePorts).length > 0 ? { composePorts } : {}),
        };
      }

      // `type` — default "git" when omitted. Validates that compose repos have composeFile.
      let type: RepoType = "git";
      if (r.type !== undefined && r.type !== null && r.type !== "") {
        if (typeof r.type !== "string" || (r.type !== "git" && r.type !== "compose")) {
          throw new ConfigError(
            `${sourcePath}: projects[${i}].repos[${j}].type must be "git" or "compose"`,
          );
        }
        type = r.type;
      }

      let composeFile: string | undefined;
      if (r.composeFile !== undefined && r.composeFile !== null && r.composeFile !== "") {
        if (typeof r.composeFile !== "string") {
          throw new ConfigError(
            `${sourcePath}: projects[${i}].repos[${j}].composeFile must be a string`,
          );
        }
        composeFile = r.composeFile;
      }

      if (type === "compose" && !composeFile) {
        throw new ConfigError(
          `${sourcePath}: projects[${i}].repos[${j}] (${rName}) has type=compose but no composeFile`,
        );
      }

      repos.push({
        name: rName,
        ...(type !== "git" ? { type } : {}),
        path: rPath,
        ...(baseBranch ? { baseBranch } : {}),
        ...(mergeStrategy ? { mergeStrategy } : {}),
        ...(tech ? { tech } : {}),
        ...(copyOnWorktree ? { copyOnWorktree } : {}),
        ...(loadEnvFiles ? { loadEnvFiles } : {}),
        ...(run ? { run } : {}),
        ...(composeFile ? { composeFile } : {}),
      });
    }

    projects.push({
      name,
      repos,
    });
  }

  return { version: 1, projects };
}

/** Find which project owns the given cwd, by matching against repo paths
 *  (and their legacy `<repo>-<feature>` sibling layout). Returns undefined
 *  when cwd isn't inside any configured repo. */
export function resolveCurrentProject(
  cfg: Config,
  cwd: string,
): ProjectConfig | undefined {
  const resolved = path.resolve(cwd);
  for (const project of cfg.projects) {
    for (const repo of project.repos) {
      const repoPath = path.resolve(repo.path);
      if (resolved === repoPath) return project;
      if (resolved.startsWith(repoPath + path.sep)) return project;
      if (resolved.startsWith(repoPath + "-")) return project;
    }
  }
  return undefined;
}

/** Look up a project by name, throwing a helpful error listing known
 *  projects when not found. */
export function getProject(cfg: Config, name: string): ProjectConfig {
  const p = cfg.projects.find((x) => x.name === name);
  if (!p) {
    const known = cfg.projects.map((x) => x.name).join(", ") || "(none)";
    throw new ConfigError(
      `unknown project "${name}". known projects: ${known}`,
    );
  }
  return p;
}

/** Look up a repo by name within a project, throwing a helpful error
 *  listing the project's known repos when not found. */
export function getRepo(project: ProjectConfig, name: string): RepoConfig {
  const r = project.repos.find((x) => x.name === name);
  if (!r) {
    const known = project.repos.map((x) => x.name).join(", ");
    throw new ConfigError(
      `unknown repo "${name}" in project "${project.name}". known repos: ${known}`,
    );
  }
  return r;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  where: string,
  source: string,
): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ConfigError(
      `${source}: ${where}.${key} must be a non-empty string`,
    );
  }
  return v;
}
