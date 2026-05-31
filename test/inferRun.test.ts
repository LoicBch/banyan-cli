import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inferRun } from "../src/inferRun.js";

let tmpRoot: string;

before(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), "banyan-infer-test-"));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function repo(name: string, files: Record<string, string>): string {
  const p = path.join(tmpRoot, name);
  mkdirSync(p, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(p, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return p;
}

describe("inferRun", () => {
  it("returns null on an empty dir", () => {
    const p = repo("empty", {});
    assert.equal(inferRun(p), null);
  });

  it("detects node + npm with scripts.dev", () => {
    const p = repo("node-npm", {
      "package.json": JSON.stringify({ scripts: { dev: "next dev" } }),
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.stack, "node + npm");
    assert.equal(result!.run.command, "npm run dev");
    assert.equal(result!.run.port, 3000);
    assert.equal(result!.run.portEnv, "PORT");
  });

  it("detects pnpm via lockfile", () => {
    const p = repo("node-pnpm", {
      "package.json": JSON.stringify({ scripts: { dev: "vite" } }),
      "pnpm-lock.yaml": "",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.run.command, "pnpm dev");
  });

  it("detects yarn via lockfile", () => {
    const p = repo("node-yarn", {
      "package.json": JSON.stringify({ scripts: { start: "node server" } }),
      "yarn.lock": "",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.run.command, "yarn start");
  });

  it("detects bun via lockfile", () => {
    const p = repo("node-bun", {
      "package.json": JSON.stringify({ scripts: { dev: "bun --watch index.ts" } }),
      "bun.lockb": "",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.run.command, "bun dev");
  });

  it("falls back to scripts.start when scripts.dev is absent", () => {
    const p = repo("node-start", {
      "package.json": JSON.stringify({ scripts: { start: "node ." } }),
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.run.command, "npm run start");
  });

  it("returns null when package.json has no useful scripts", () => {
    const p = repo("node-nope", {
      "package.json": JSON.stringify({ scripts: { test: "jest" } }),
    });
    assert.equal(inferRun(p), null);
  });

  it("returns null when package.json is malformed", () => {
    const p = repo("node-broken", { "package.json": "not json" });
    assert.equal(inferRun(p), null);
  });

  it("detects gradle + spring boot", () => {
    const p = repo("gradle-spring", {
      "build.gradle":
        `plugins { id 'org.springframework.boot' version '3.2.0' }`,
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.stack, "gradle + spring boot");
    assert.equal(result!.run.command, "./gradlew bootRun");
    assert.equal(result!.run.port, 8080);
    assert.equal(result!.run.portEnv, "SERVER_PORT");
    assert.equal(result!.run.stopCommand, "./gradlew --stop");
  });

  it("detects gradle.kts + spring boot", () => {
    const p = repo("gradle-kts", {
      "build.gradle.kts":
        `plugins { id("org.springframework.boot") version "3.2.0" }`,
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.stack, "gradle + spring boot");
  });

  it("returns null on plain gradle without spring boot or android plugin", () => {
    const p = repo("gradle-plain", {
      "build.gradle":
        `apply plugin: 'java-library'`,
    });
    assert.equal(inferRun(p), null);
  });

  it("detects maven + spring boot", () => {
    const p = repo("maven-spring", {
      "pom.xml": `<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>`,
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.stack, "maven + spring boot");
    assert.equal(result!.run.command, "mvn spring-boot:run");
    assert.equal(result!.run.port, 8080);
  });

  it("returns null on maven without spring", () => {
    const p = repo("maven-nope", {
      "pom.xml": `<project><artifactId>just-a-lib</artifactId></project>`,
    });
    assert.equal(inferRun(p), null);
  });

  it("detects go with single cmd dir", () => {
    const p = repo("go-cmd", {
      "go.mod": "module example.com/x",
      "cmd/server/main.go": "package main",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.stack, "go");
    assert.equal(result!.run.command, "go run ./cmd/server");
  });

  it("detects go with no cmd dir → run .", () => {
    const p = repo("go-flat", {
      "go.mod": "module example.com/x",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.run.command, "go run .");
  });

  it("detects go with multiple cmd dirs → run . (avoid guessing)", () => {
    const p = repo("go-multi", {
      "go.mod": "module example.com/x",
      "cmd/api/main.go": "package main",
      "cmd/worker/main.go": "package main",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.run.command, "go run .");
  });

  it("detection priority: package.json wins over go.mod (rare but possible)", () => {
    const p = repo("hybrid", {
      "package.json": JSON.stringify({ scripts: { dev: "vite" } }),
      "go.mod": "module example.com/x",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.stack, "node + npm");
  });

  // ── Android ──────────────────────────────────────────────────────────────

  it("detects android (apply plugin) with default 'app' module", () => {
    const p = repo("android-default", {
      "build.gradle": `apply plugin: 'com.android.application'`,
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.stack, "android (gradle)");
    assert.match(result!.run.command, /:app:installDebug/);
    assert.match(result!.run.command, /<your\.package>/);
  });

  it("detects android via app/build.gradle with applicationId", () => {
    const p = repo("android-with-id", {
      "settings.gradle": `include ':app'`,
      "app/build.gradle": `
        apply plugin: 'com.android.application'
        android { defaultConfig { applicationId "com.example.demo" } }
      `,
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.stack, "android (gradle)");
    assert.match(result!.run.command, /com\.example\.demo\/\.MainActivity/);
  });

  it("detects custom android module name", () => {
    const p = repo("android-custom", {
      "settings.gradle": `include(":mobile")`,
      "mobile/build.gradle": `apply plugin: 'com.android.application'`,
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.match(result!.run.command, /:mobile:installDebug/);
  });

  it("android detection wins over generic gradle", () => {
    // A bare gradle file without spring-boot would return null;
    // but with com.android.application it's detected as android.
    const p = repo("android-vs-generic", {
      "build.gradle": `apply plugin: 'com.android.application'`,
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.equal(result!.stack, "android (gradle)");
  });

  // ── Python ───────────────────────────────────────────────────────────────

  it("detects django via manage.py", () => {
    const p = repo("django", {
      "manage.py": "import django",
      "requirements.txt": "django==5.0",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.match(result!.stack, /django/);
    assert.match(result!.run.command, /manage\.py runserver/);
    assert.equal(result!.run.port, 8000);
  });

  it("detects django + poetry", () => {
    const p = repo("django-poetry", {
      "manage.py": "",
      "pyproject.toml": "[tool.poetry]\nname = \"demo\"",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.match(result!.stack, /poetry/);
    assert.match(result!.run.command, /^poetry run /);
  });

  it("detects fastapi via dep + main.py", () => {
    const p = repo("fastapi", {
      "requirements.txt": "fastapi==0.110\nuvicorn",
      "main.py": "from fastapi import FastAPI\napp = FastAPI()",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.match(result!.stack, /fastapi/);
    assert.match(result!.run.command, /uvicorn main:app/);
  });

  it("detects fastapi + uv", () => {
    const p = repo("fastapi-uv", {
      "pyproject.toml": "[project]\ndependencies = [\"fastapi\"]",
      "uv.lock": "",
      "main.py": "app = FastAPI()",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.match(result!.run.command, /^uv run /);
  });

  it("detects flask", () => {
    const p = repo("flask", {
      "requirements.txt": "Flask==3.0",
      "app.py": "from flask import Flask",
    });
    const result = inferRun(p);
    assert.ok(result);
    assert.match(result!.stack, /flask/);
    assert.match(result!.run.command, /flask --app app run/);
    assert.equal(result!.run.port, 5000);
  });

  it("returns null on python with no recognised framework", () => {
    const p = repo("python-script", {
      "requirements.txt": "requests==2.31\nclick",
    });
    assert.equal(inferRun(p), null);
  });
});
