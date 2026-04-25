import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import { ConfigError } from "./errors.js";

export interface RunConfig {
  command: string;
  port?: number;
  portEnv?: string;
  setup?: string;
  /**
   * Command to run by `bn test-stop` in the feature worktree, in addition to
   * killing the tmux window. Useful for stacks whose processes detach from
   * the tmux pane and survive SIGHUP (e.g. Gradle daemon, pm2, systemd user
   * services, nodemon with bg). Stays agnostic — you declare what "stop"
   * means for your stack.
   *
   * Examples:
   *   stopCommand: "./gradlew --stop"           # Gradle Daemon
   *   stopCommand: "pm2 delete app"             # pm2
   *   stopCommand: "pkill -f 'node scripts/dev.js'"
   */
  stopCommand?: string;
  /**
   * Extra env vars prefixed to the run command, supporting cross-repo port
   * references. Substitutions happen in banyan before invoking the command,
   * so the result is literal KEY=value pairs.
   *
   * Syntax: `{{<repoName>.port}}` — the host port allocated to that repo
   * by `bn test` (its `run.port` base + first free offset).
   *
   * Example (React front that needs to reach a dynamically-ported back):
   *   env:
   *     REACT_APP_API_URL: "http://localhost:{{back.port}}"
   */
  env?: Record<string, string>;
  /**
   * Map env-var names to `<service>:<container-port>` pointers. When `bn test`
   * runs and a compose stack is up for this feature, banyan queries the actual
   * host-side port each service's container-port is bound to and injects it as
   * the given env var.
   *
   * Example:
   *   composePorts:
   *     DB_PORT: "mysql:3306"
   *     REDIS_PORT: "redis:6379"
   */
  composePorts?: Record<string, string>;
}

export type RepoType = "git" | "compose";

export interface RepoConfig {
  name: string;
  type?: RepoType;           // default: "git"
  path: string;
  baseBranch?: string;
  run?: RunConfig;
  deployCommand?: string;
  // For type=compose only:
  composeFile?: string;      // path relative to `path`, or absolute
}

export interface ProjectConfig {
  name: string;
  layoutScript?: string;
  deployCommand?: string;
  repos: RepoConfig[];
}

export interface Config {
  version: 1;
  projects: ProjectConfig[];
}

export function defaultConfigPath(): string {
  return (
    process.env.BANYAN_CONFIG ??
    path.join(homedir(), ".config", "banyan", "config.yaml")
  );
}

export function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}

export function contractHome(p: string): string {
  const home = homedir();
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return "~" + p.slice(home.length);
  return p;
}

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
      ...(p.layoutScript ? { layoutScript: contractHome(p.layoutScript) } : {}),
      ...(p.deployCommand ? { deployCommand: p.deployCommand } : {}),
      repos: p.repos.map((r) => ({
        name: r.name,
        ...(r.type && r.type !== "git" ? { type: r.type } : {}),
        path: contractHome(r.path),
        ...(r.baseBranch ? { baseBranch: r.baseBranch } : {}),
        ...(r.run
          ? {
              run: {
                command: r.run.command,
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

    let layoutScript: string | undefined;
    if (p.layoutScript !== undefined && p.layoutScript !== null && p.layoutScript !== "") {
      if (typeof p.layoutScript !== "string") {
        throw new ConfigError(
          `${sourcePath}: projects[${i}].layoutScript must be a string`,
        );
      }
      layoutScript = expandHome(p.layoutScript);
    }

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
        run = {
          command,
          ...(port !== undefined ? { port } : {}),
          ...(portEnv ? { portEnv } : {}),
          ...(setup ? { setup } : {}),
          ...(stopCommand ? { stopCommand } : {}),
          ...(envMap && Object.keys(envMap).length > 0 ? { env: envMap } : {}),
          ...(composePorts && Object.keys(composePorts).length > 0 ? { composePorts } : {}),
        };
      }

      let deployCommand: string | undefined;
      if (r.deployCommand !== undefined && r.deployCommand !== null && r.deployCommand !== "") {
        if (typeof r.deployCommand !== "string") {
          throw new ConfigError(
            `${sourcePath}: projects[${i}].repos[${j}].deployCommand must be a string`,
          );
        }
        deployCommand = r.deployCommand;
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
        ...(run ? { run } : {}),
        ...(deployCommand ? { deployCommand } : {}),
        ...(composeFile ? { composeFile } : {}),
      });
    }

    let projectDeployCommand: string | undefined;
    if (p.deployCommand !== undefined && p.deployCommand !== null && p.deployCommand !== "") {
      if (typeof p.deployCommand !== "string") {
        throw new ConfigError(
          `${sourcePath}: projects[${i}].deployCommand must be a string`,
        );
      }
      projectDeployCommand = p.deployCommand;
    }

    projects.push({
      name,
      ...(layoutScript ? { layoutScript } : {}),
      ...(projectDeployCommand ? { deployCommand: projectDeployCommand } : {}),
      repos,
    });
  }

  return { version: 1, projects };
}

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
