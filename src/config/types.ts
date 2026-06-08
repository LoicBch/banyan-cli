/**
 * Config schema — pure type definitions.
 *
 * Kept in a dependency-free module so any other code (runtime, loader,
 * validation, dashboard types) can import the schema without dragging in
 * file I/O or YAML parsing.
 */

export interface RunConfig {
  command: string;
  /**
   * Named alternative commands for this repo. Use cases: switching between
   * `./gradlew installDebug` and `emulator -avd Pixel_7_API_34`, or between
   * debug / release builds. Edit from the dashboard's Config tab.
   *
   * Example:
   *   presets:
   *     gradle:   "./gradlew installDebug"
   *     emulator: "emulator -avd Pixel_7_API_34 -no-snapshot-load"
   *   activePreset: emulator
   */
  presets?: Record<string, string>;
  /** Name of the currently selected preset. When set AND present in
   *  `presets`, that preset's command is used in place of `command`. When
   *  unset (or pointing at a missing preset), falls back to `command`. */
  activePreset?: string;
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
  /** Strategy to use when merging via the PR/MR flow. Defaults to "squash"
   *  if not set. Per-repo because conventions vary across teams. */
  mergeStrategy?: "squash" | "merge" | "rebase";
  /** Tech profile id picked at creation time (node, spring-boot, android,
   *  django, custom). Free-form string in the schema so the dashboard can
   *  evolve its profile list without a config migration. Today purely
   *  informational; future banyan features may specialize behavior on it. */
  tech?: string;
  /** Files to copy from the main checkout into a freshly-created worktree.
   *  Paths are relative to the repo root, may include subdirectories, and
   *  must not contain `..`. Missing source files are skipped silently; the
   *  destination is never overwritten if it already exists.
   *
   *  Typical use: gitignored dev secrets that every worktree still needs.
   *
   *  Example:
   *    copyOnWorktree:
   *      - .env
   *      - .env.local
   *      - src/main/resources/application-local.yml
   */
  copyOnWorktree?: string[];
  /** `.env`-style files to parse and inject into the run command's
   *  environment at spawn time. Paths are relative to the *worktree* (so
   *  per-feature customizations apply). Same path safety rules as
   *  `copyOnWorktree`. Banyan's dynamic values (port allocation,
   *  composePorts, declared `run.env`) take precedence — they're applied
   *  AFTER, so the shell uses them.
   *
   *  Useful for stacks that don't auto-load `.env` (Spring Boot, Django,
   *  plain Node, Go). Pair with `copyOnWorktree` to seed the file first.
   *
   *  Example:
   *    loadEnvFiles:
   *      - .env.local
   */
  loadEnvFiles?: string[];
  run?: RunConfig;
  // For type=compose only:
  composeFile?: string;      // path relative to `path`, or absolute
}

export interface ProjectConfig {
  name: string;
  repos: RepoConfig[];
}

export interface Config {
  version: 1;
  projects: ProjectConfig[];
}
