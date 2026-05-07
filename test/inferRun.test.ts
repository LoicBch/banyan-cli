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

  it("returns null on plain gradle without spring boot (could be Android)", () => {
    const p = repo("gradle-android", {
      "build.gradle":
        `apply plugin: 'com.android.application'`,
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
});
