import path from "node:path";
import { existsSync } from "node:fs";
import { run, runInherit } from "./exec.js";
import { UsageError } from "./errors.js";
import type { ProjectConfig, RepoConfig } from "./config.js";

/**
 * Compose stack naming: every feature gets a unique docker-compose project name
 * so multiple features can be up at the same time without conflicts.
 */
export function composeProjectName(project: ProjectConfig, feature: string): string {
  // sanitize: lowercase, strip non-alphanumeric/dash/underscore
  const sanitize = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return `${sanitize(project.name)}-${sanitize(feature)}`;
}

/**
 * Resolve the absolute path of the compose file (it's stored relative to the repo's `path`
 * unless it starts with / or ~).
 */
export function resolveComposeFile(repo: RepoConfig): string {
  if (!repo.composeFile) {
    throw new UsageError(`repo "${repo.name}" is type=compose but has no composeFile set`);
  }
  if (path.isAbsolute(repo.composeFile)) return repo.composeFile;
  return path.join(repo.path, repo.composeFile);
}

function baseArgs(repo: RepoConfig, project: ProjectConfig, feature: string): string[] {
  const composeFile = resolveComposeFile(repo);
  if (!existsSync(composeFile)) {
    throw new UsageError(`compose file not found: ${composeFile}`);
  }
  return [
    "compose",
    "-p", composeProjectName(project, feature),
    "-f", composeFile,
    "--project-directory", repo.path,
  ];
}

/** `docker compose up -d` for the feature. */
export async function up(
  repo: RepoConfig,
  project: ProjectConfig,
  feature: string,
): Promise<void> {
  // `--wait` blocks until every service with a healthcheck is healthy. Critical
  // here because MySQL runs its /docker-entrypoint-initdb.d/ scripts (e.g. a
  // prod dump import) BEFORE accepting external connections; without --wait,
  // banyan returns immediately and downstream `bn test` launches the back
  // against a still-booting DB → EOFException on the first query.
  const r = await run("docker", [
    ...baseArgs(repo, project, feature),
    "up",
    "-d",
    "--wait",
  ]);
  if (r.code !== 0) {
    throw new UsageError(
      `docker compose up failed for ${project.name}/${feature} (${repo.name}):\n${r.stderr.trim()}`,
    );
  }
}

/** `docker compose down` — stops containers, keeps volumes. */
export async function down(
  repo: RepoConfig,
  project: ProjectConfig,
  feature: string,
): Promise<void> {
  const r = await run("docker", [...baseArgs(repo, project, feature), "down"]);
  if (r.code !== 0 && !r.stderr.includes("not found")) {
    throw new UsageError(`docker compose down failed: ${r.stderr.trim()}`);
  }
}

/** `docker compose down -v` — destroys containers AND volumes. */
export async function downVolumes(
  repo: RepoConfig,
  project: ProjectConfig,
  feature: string,
): Promise<void> {
  const r = await run("docker", [...baseArgs(repo, project, feature), "down", "-v"]);
  if (r.code !== 0 && !r.stderr.includes("not found")) {
    throw new UsageError(`docker compose down -v failed: ${r.stderr.trim()}`);
  }
}

/** `docker compose down -v && up -d` — fresh slate. */
export async function recreate(
  repo: RepoConfig,
  project: ProjectConfig,
  feature: string,
): Promise<void> {
  await downVolumes(repo, project, feature);
  await up(repo, project, feature);
}

export interface ComposeServiceStatus {
  name: string;
  state: string;        // "running", "exited", etc.
  image?: string;
  health?: string;
}

/** Query running services in a stack. Returns [] if stack doesn't exist. */
export async function psServices(
  repo: RepoConfig,
  project: ProjectConfig,
  feature: string,
): Promise<ComposeServiceStatus[]> {
  const r = await run("docker", [
    ...baseArgs(repo, project, feature),
    "ps", "--format", "json",
  ]);
  if (r.code !== 0) return [];
  // `docker compose ps --format json` emits one JSON object per line
  const services: ComposeServiceStatus[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      services.push({
        name: obj.Service ?? obj.Name ?? "",
        state: obj.State ?? "",
        image: obj.Image,
        health: obj.Health,
      });
    } catch {
      // skip malformed lines
    }
  }
  return services;
}

/** Whether the compose stack has at least one running service. */
export async function isUp(
  repo: RepoConfig,
  project: ProjectConfig,
  feature: string,
): Promise<boolean> {
  const services = await psServices(repo, project, feature);
  return services.some((s) => s.state === "running");
}

/** `docker compose logs -f [service]` — inherits stdio for live tail. */
export async function logs(
  repo: RepoConfig,
  project: ProjectConfig,
  feature: string,
  service?: string,
): Promise<number> {
  const args = [...baseArgs(repo, project, feature), "logs", "-f"];
  if (service) args.push(service);
  return runInherit("docker", args);
}

/** `docker compose exec <service> <cmd...>` interactive. */
export async function exec(
  repo: RepoConfig,
  project: ProjectConfig,
  feature: string,
  service: string,
  cmd: string[],
): Promise<number> {
  return runInherit("docker", [
    ...baseArgs(repo, project, feature),
    "exec",
    service,
    ...cmd,
  ]);
}

/**
 * Query a service's host-side port mapping.
 * Returns the host port for a given container port, or undefined if not exposed.
 * Phase B will use this to inject env vars into `bn test`.
 */
export async function servicePort(
  repo: RepoConfig,
  project: ProjectConfig,
  feature: string,
  service: string,
  containerPort: number,
): Promise<number | undefined> {
  const r = await run("docker", [
    ...baseArgs(repo, project, feature),
    "port", service, String(containerPort),
  ]);
  if (r.code !== 0) return undefined;
  // Output: "0.0.0.0:49172\n::/49172" or similar
  const match = r.stdout.match(/:(\d+)\s*$/m);
  return match ? Number(match[1]) : undefined;
}
