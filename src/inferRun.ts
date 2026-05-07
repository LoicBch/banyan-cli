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
    detectAndroid(repoPath) ??     // before generic Gradle (Android also uses gradle)
    detectGradle(repoPath) ??
    detectMaven(repoPath) ??
    detectPython(repoPath) ??
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

// ── Android ────────────────────────────────────────────────────────────────

function detectAndroid(repoPath: string): InferredRun | null {
  // Look for the Android plugin in:
  //  - root build.gradle(.kts)
  //  - app/build.gradle(.kts) (default convention)
  //  - <module>/build.gradle(.kts) for any module declared in settings.gradle
  // Tracks which dir matched so we can name the right module to install.
  const modulesFromSettings = listGradleModules(repoPath);
  const candidateDirs = new Set<string>(["", "app", ...modulesFromSettings]);

  let foundModule: string | undefined;
  for (const mod of candidateDirs) {
    const base = mod ? path.join(repoPath, mod) : repoPath;
    if (
      fileMatchesAny(path.join(base, "build.gradle"), /com\.android\.application/) ||
      fileMatchesAny(path.join(base, "build.gradle.kts"), /com\.android\.application/)
    ) {
      // Root-level android plugin → assume the install target is "app" by
      // convention (the most common single-module Android project shape).
      foundModule = mod || "app";
      break;
    }
  }
  if (!foundModule) return null;

  const moduleName = foundModule;

  // Try to recover the application id (package) so we can launch the
  // activity automatically. Optional — if we can't find it, we ship a
  // placeholder the user fills in.
  const applicationId = detectAndroidApplicationId(repoPath);

  const installCmd = `./gradlew :${moduleName}:installDebug`;
  const launchCmd = applicationId
    ? `adb shell am start -n ${applicationId}/.MainActivity`
    : `adb shell am start -n <your.package>/.MainActivity`;

  return {
    stack: "android (gradle)",
    run: {
      command: `${installCmd} && ${launchCmd}`,
      // No port concept for Android. banyan's `composePorts` + `adb reverse`
      // automation handles cross-repo port plumbing when other repos in the
      // project expose ports.
      stopCommand: "./gradlew --stop",
    },
  };
}

function listGradleModules(repoPath: string): string[] {
  const out: string[] = [];
  for (const f of ["settings.gradle", "settings.gradle.kts"]) {
    const p = path.join(repoPath, f);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, "utf8");
      // Match `include ':foo'`, `include(":bar")`, etc. Captures the module
      // name without the leading colon.
      const re = /include\s*\(?\s*['"]:?([\w.-]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) out.push(m[1]);
    } catch {
      // ignore
    }
  }
  return out;
}

function detectAndroidApplicationId(repoPath: string): string | undefined {
  // Look in app/build.gradle(.kts) for `applicationId "com.foo.bar"`.
  for (const f of ["app/build.gradle", "app/build.gradle.kts", "build.gradle", "build.gradle.kts"]) {
    const p = path.join(repoPath, f);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, "utf8");
      const m = content.match(/applicationId\s*[=]?\s*['"]([\w.]+)['"]/);
      if (m) return m[1];
    } catch {
      // ignore
    }
  }
  return undefined;
}

function fileMatchesAny(p: string, re: RegExp): boolean {
  if (!existsSync(p)) return false;
  try {
    return re.test(readFileSync(p, "utf8"));
  } catch {
    return false;
  }
}

// ── Python ─────────────────────────────────────────────────────────────────

function detectPython(repoPath: string): InferredRun | null {
  const hasPython =
    existsSync(path.join(repoPath, "pyproject.toml")) ||
    existsSync(path.join(repoPath, "requirements.txt")) ||
    existsSync(path.join(repoPath, "Pipfile")) ||
    existsSync(path.join(repoPath, "setup.py")) ||
    existsSync(path.join(repoPath, "manage.py"));
  if (!hasPython) return null;

  const runner = detectPythonRunner(repoPath);

  // Django — most reliable signal: a manage.py at the root.
  if (existsSync(path.join(repoPath, "manage.py"))) {
    return {
      stack: `python + django${runner ? " (" + runner + ")" : ""}`,
      run: {
        command: prefixPythonRunner(runner, "python manage.py runserver 0.0.0.0:$PORT"),
        port: 8000,
        portEnv: "PORT",
      },
    };
  }

  // FastAPI — look for fastapi in pyproject/requirements + a guess at the
  // module name.
  if (hasPythonDep(repoPath, /\bfastapi\b/)) {
    const module = guessFastApiModule(repoPath) ?? "main:app";
    return {
      stack: `python + fastapi${runner ? " (" + runner + ")" : ""}`,
      run: {
        command: prefixPythonRunner(
          runner,
          `uvicorn ${module} --reload --host 0.0.0.0 --port $PORT`,
        ),
        port: 8000,
        portEnv: "PORT",
      },
    };
  }

  // Flask
  if (hasPythonDep(repoPath, /\bflask\b/i)) {
    const appModule = guessFlaskApp(repoPath) ?? "app";
    return {
      stack: `python + flask${runner ? " (" + runner + ")" : ""}`,
      run: {
        command: prefixPythonRunner(
          runner,
          `flask --app ${appModule} run --host 0.0.0.0 --port $PORT`,
        ),
        port: 5000,
        portEnv: "PORT",
      },
    };
  }

  // Recognised as Python but no known framework — leave to manual.
  return null;
}

type PythonRunner = "poetry" | "uv" | "pipenv";

function detectPythonRunner(repoPath: string): PythonRunner | undefined {
  if (existsSync(path.join(repoPath, "uv.lock"))) return "uv";
  if (existsSync(path.join(repoPath, "poetry.lock"))) return "poetry";
  if (existsSync(path.join(repoPath, "Pipfile.lock")) || existsSync(path.join(repoPath, "Pipfile"))) {
    return "pipenv";
  }
  // pyproject.toml with [tool.poetry] is also a strong signal even without
  // the lockfile.
  const pyproject = path.join(repoPath, "pyproject.toml");
  if (existsSync(pyproject)) {
    try {
      const content = readFileSync(pyproject, "utf8");
      if (/\[tool\.poetry\]/.test(content)) return "poetry";
      if (/\[tool\.uv\]/.test(content)) return "uv";
    } catch {
      // ignore
    }
  }
  return undefined;
}

function prefixPythonRunner(runner: PythonRunner | undefined, cmd: string): string {
  if (!runner) return cmd;
  if (runner === "poetry") return `poetry run ${cmd}`;
  if (runner === "uv") return `uv run ${cmd}`;
  if (runner === "pipenv") return `pipenv run ${cmd}`;
  return cmd;
}

function hasPythonDep(repoPath: string, re: RegExp): boolean {
  for (const f of ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"]) {
    if (fileMatchesAny(path.join(repoPath, f), re)) return true;
  }
  return false;
}

function guessFastApiModule(repoPath: string): string | undefined {
  // Common conventions: main.py with `app = FastAPI()` at root, or
  // app/main.py, or src/main.py.
  for (const candidate of [
    { file: "main.py",     module: "main:app" },
    { file: "app/main.py", module: "app.main:app" },
    { file: "src/main.py", module: "src.main:app" },
    { file: "app.py",      module: "app:app" },
  ]) {
    const p = path.join(repoPath, candidate.file);
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf8");
        if (/=\s*FastAPI\s*\(/.test(content)) return candidate.module;
      } catch {
        // ignore
      }
    }
  }
  return undefined;
}

function guessFlaskApp(repoPath: string): string | undefined {
  // `flask --app <X>` accepts a module name.
  for (const candidate of [
    { file: "app.py",      module: "app" },
    { file: "main.py",     module: "main" },
    { file: "wsgi.py",     module: "wsgi" },
  ]) {
    if (existsSync(path.join(repoPath, candidate.file))) {
      return candidate.module;
    }
  }
  return undefined;
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
