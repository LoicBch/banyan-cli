/**
 * Heuristic detection of a repo's "run config" — what command spins up the
 * dev server, and what port + env-var convention the stack uses.
 *
 * Pure function: takes a repo path, looks at well-known marker files
 * (package.json, build.gradle, pom.xml, go.mod, ...) and returns a best-
 * guess RunConfig or null if it doesn't recognise the stack.
 *
 * Coverage v1 (most common ~80%):
 *   - Node ecosystem (npm/pnpm/yarn/bun) via package.json
 *   - Gradle / Spring Boot via build.gradle(.kts)
 *   - Maven / Spring Boot via pom.xml
 *   - Go services via go.mod
 *
 * Skipped intentionally: Python (too many flavours — Django, FastAPI,
 * Flask, uv, poetry — no clean default), Rust (no port convention for
 * `cargo run`), Android (no port concept), Docker compose (different
 * `type: compose` config path entirely).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { RunConfig } from "./config.js";

export interface InferredRun {
  run: RunConfig;
  /** Human-readable label for the detected stack (e.g. "node + pnpm"). */
  stack: string;
}

export function inferRun(repoPath: string): InferredRun | null {
  return (
    detectNode(repoPath) ??
    detectGradle(repoPath) ??
    detectMaven(repoPath) ??
    detectGo(repoPath) ??
    null
  );
}

// ── Node ───────────────────────────────────────────────────────────────────

function detectNode(repoPath: string): InferredRun | null {
  const pkgPath = path.join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return null;

  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }

  const scripts = pkg.scripts ?? {};
  // Pick the most likely "dev" script, in order of conventional preference.
  const scriptName =
    ["dev", "start:dev", "serve", "develop", "start"]
      .find((s) => typeof scripts[s] === "string") ?? null;
  if (!scriptName) return null;

  const pm = detectPackageManager(repoPath);
  // `pnpm run` and `yarn run` work everywhere; `npm run` too. Prefer the
  // bare form for readability where the package manager supports it.
  const command =
    pm === "npm"
      ? `npm run ${scriptName}`
      : `${pm} ${scriptName}`;

  return {
    stack: `node + ${pm}`,
    run: {
      command,
      port: 3000,
      portEnv: "PORT",
    },
  };
}

function detectPackageManager(repoPath: string): "npm" | "pnpm" | "yarn" | "bun" {
  if (existsSync(path.join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(repoPath, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(repoPath, "bun.lockb"))) return "bun";
  return "npm";
}

// ── Gradle / Spring Boot ───────────────────────────────────────────────────

function detectGradle(repoPath: string): InferredRun | null {
  const hasGradle =
    existsSync(path.join(repoPath, "build.gradle")) ||
    existsSync(path.join(repoPath, "build.gradle.kts"));
  if (!hasGradle) return null;

  // Heuristic: if any module declares spring-boot deps, it's a Spring Boot
  // service and `bootRun` is the right verb. Otherwise we can't reliably
  // guess (could be Android, generic Java lib, etc.) — return null and let
  // the user configure manually.
  if (!hasSpringBoot(repoPath)) return null;

  return {
    stack: "gradle + spring boot",
    run: {
      command: "./gradlew bootRun",
      port: 8080,
      portEnv: "SERVER_PORT",
      // gradle daemons stick around — give the user the right way to stop.
      stopCommand: "./gradlew --stop",
    },
  };
}

function hasSpringBoot(repoPath: string): boolean {
  for (const f of ["build.gradle", "build.gradle.kts"]) {
    const p = path.join(repoPath, f);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, "utf8");
      if (/spring-boot|org\.springframework\.boot/i.test(content)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

// ── Maven / Spring Boot ────────────────────────────────────────────────────

function detectMaven(repoPath: string): InferredRun | null {
  const pomPath = path.join(repoPath, "pom.xml");
  if (!existsSync(pomPath)) return null;
  try {
    const content = readFileSync(pomPath, "utf8");
    if (!/spring-boot/i.test(content)) return null;
  } catch {
    return null;
  }
  return {
    stack: "maven + spring boot",
    run: {
      command: "mvn spring-boot:run",
      port: 8080,
      portEnv: "SERVER_PORT",
    },
  };
}

// ── Go ─────────────────────────────────────────────────────────────────────

function detectGo(repoPath: string): InferredRun | null {
  if (!existsSync(path.join(repoPath, "go.mod"))) return null;

  // Prefer cmd/<name>/main.go layouts; fall back to root main.go.
  const cmdDir = path.join(repoPath, "cmd");
  let target = ".";
  if (existsSync(cmdDir)) {
    try {
      const dirs = readdirSync(cmdDir).filter((d) =>
        statSync(path.join(cmdDir, d)).isDirectory(),
      );
      if (dirs.length === 1) target = `./cmd/${dirs[0]}`;
      // If multiple cmd dirs, leave as "." — user can edit.
    } catch {
      // ignore
    }
  }
  return {
    stack: "go",
    run: {
      command: `go run ${target}`,
      port: 8080,
      portEnv: "PORT",
    },
  };
}
