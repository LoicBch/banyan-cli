import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyDeclaredFiles } from "../src/worktreeFiles.js";

// Minimal logger that captures messages for assertion. Conforms to the
// CopyLogger interface but stores everything for verification.
function makeLogger() {
  const out: { info: string[]; warn: string[] } = { info: [], warn: [] };
  return {
    log: {
      info: (msg: string) => out.info.push(msg),
      warn: (msg: string) => out.warn.push(msg),
    },
    captured: out,
  };
}

describe("copyDeclaredFiles", () => {
  let src: string;
  let dst: string;

  beforeEach(() => {
    src = mkdtempSync(path.join(tmpdir(), "banyan-wtf-src-"));
    dst = mkdtempSync(path.join(tmpdir(), "banyan-wtf-dst-"));
  });

  afterEach(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(dst, { recursive: true, force: true });
  });

  it("copies a single file from src to dst", () => {
    writeFileSync(path.join(src, ".env"), "DB=localhost\n");
    const { log, captured } = makeLogger();

    const report = copyDeclaredFiles(src, dst, [".env"], log);

    assert.deepEqual(report.copied, [".env"]);
    assert.equal(report.skippedMissingSrc.length, 0);
    assert.equal(report.skippedDstExists.length, 0);
    assert.equal(readFileSync(path.join(dst, ".env"), "utf8"), "DB=localhost\n");
    assert.ok(captured.info.some((m) => m.includes(".env → worktree")));
  });

  it("copies multiple files in order", () => {
    writeFileSync(path.join(src, ".env"), "a");
    writeFileSync(path.join(src, ".env.local"), "b");
    writeFileSync(path.join(src, "local.properties"), "c");

    const report = copyDeclaredFiles(
      src,
      dst,
      [".env", ".env.local", "local.properties"],
    );

    assert.deepEqual(report.copied, [".env", ".env.local", "local.properties"]);
    assert.equal(readFileSync(path.join(dst, ".env"), "utf8"), "a");
    assert.equal(readFileSync(path.join(dst, ".env.local"), "utf8"), "b");
    assert.equal(readFileSync(path.join(dst, "local.properties"), "utf8"), "c");
  });

  it("creates intermediate directories when the entry is nested", () => {
    mkdirSync(path.join(src, "src/main/resources"), { recursive: true });
    writeFileSync(
      path.join(src, "src/main/resources/application-local.yml"),
      "spring.datasource.url: jdbc:mysql://localhost\n",
    );

    const report = copyDeclaredFiles(src, dst, [
      "src/main/resources/application-local.yml",
    ]);

    assert.equal(report.copied.length, 1);
    assert.ok(existsSync(path.join(dst, "src/main/resources/application-local.yml")));
  });

  it("skips and logs files missing from the source", () => {
    const { log, captured } = makeLogger();

    const report = copyDeclaredFiles(src, dst, [".env"], log);

    assert.equal(report.copied.length, 0);
    assert.deepEqual(report.skippedMissingSrc, [".env"]);
    assert.ok(captured.info.some((m) => m.includes("not in main checkout")));
  });

  it("does not overwrite a destination that already exists", () => {
    writeFileSync(path.join(src, ".env"), "FROM_SRC\n");
    writeFileSync(path.join(dst, ".env"), "FROM_DST\n");
    const { log, captured } = makeLogger();

    const report = copyDeclaredFiles(src, dst, [".env"], log);

    assert.equal(report.copied.length, 0);
    assert.deepEqual(report.skippedDstExists, [".env"]);
    assert.equal(readFileSync(path.join(dst, ".env"), "utf8"), "FROM_DST\n");
    assert.ok(captured.info.some((m) => m.includes("keeping existing")));
  });

  it("refuses entries containing '..' (defense-in-depth)", () => {
    writeFileSync(path.join(src, "sensitive"), "x");
    const { log, captured } = makeLogger();

    const report = copyDeclaredFiles(src, dst, ["../sensitive"], log);

    assert.equal(report.copied.length, 0);
    assert.ok(captured.warn.some((m) => m.includes("unsafe path")));
    // Nothing should land outside dst.
    assert.equal(existsSync(path.join(path.dirname(dst), "sensitive")), false);
  });

  it("refuses absolute paths (defense-in-depth)", () => {
    const { log, captured } = makeLogger();

    const report = copyDeclaredFiles(src, dst, ["/etc/passwd"], log);

    assert.equal(report.copied.length, 0);
    assert.ok(captured.warn.some((m) => m.includes("unsafe path")));
  });

  it("skips directories — only regular files are supported", () => {
    mkdirSync(path.join(src, "secrets"), { recursive: true });
    writeFileSync(path.join(src, "secrets", "key"), "x");
    const { log, captured } = makeLogger();

    const report = copyDeclaredFiles(src, dst, ["secrets"], log);

    assert.equal(report.copied.length, 0);
    assert.ok(captured.warn.some((m) => m.includes("not a regular file")));
    assert.equal(existsSync(path.join(dst, "secrets")), false);
  });

  it("returns an empty report for an empty file list (no logger calls)", () => {
    const { log, captured } = makeLogger();

    const report = copyDeclaredFiles(src, dst, [], log);

    assert.deepEqual(report, { copied: [], skippedMissingSrc: [], skippedDstExists: [] });
    assert.equal(captured.info.length, 0);
    assert.equal(captured.warn.length, 0);
  });

  it("continues processing remaining entries when one fails", () => {
    writeFileSync(path.join(src, ".env"), "a");
    writeFileSync(path.join(src, "ok"), "b");
    const { log } = makeLogger();

    // First entry is unsafe → warn + skip. Second + third proceed normally.
    const report = copyDeclaredFiles(src, dst, ["../bad", ".env", "ok"], log);

    assert.deepEqual(report.copied, [".env", "ok"]);
  });
});

// ── Schema-level validation ───────────────────────────────────────────────
// These tests live alongside the copy tests because the schema rejection is
// the first line of defense — by the time copyDeclaredFiles runs, the
// validator has already eliminated bad entries. We verify that contract here.

import { validateConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

function withCopyOnWorktree(entries: unknown): unknown {
  return {
    version: 1,
    projects: [
      {
        name: "p",
        repos: [
          { name: "r", path: "/tmp/p/r", copyOnWorktree: entries },
        ],
      },
    ],
  };
}

describe("validateConfig copyOnWorktree", () => {
  it("accepts a list of relative paths", () => {
    const cfg = validateConfig(withCopyOnWorktree([".env", "src/x.yml"]), "test");
    assert.deepEqual(cfg.projects[0]!.repos[0]!.copyOnWorktree, [".env", "src/x.yml"]);
  });

  it("treats an empty list as 'not set'", () => {
    const cfg = validateConfig(withCopyOnWorktree([]), "test");
    assert.equal(cfg.projects[0]!.repos[0]!.copyOnWorktree, undefined);
  });

  it("rejects non-array values", () => {
    assert.throws(
      () => validateConfig(withCopyOnWorktree(".env"), "test"),
      ConfigError,
    );
  });

  it("rejects empty strings", () => {
    assert.throws(
      () => validateConfig(withCopyOnWorktree([".env", ""]), "test"),
      ConfigError,
    );
  });

  it("rejects absolute paths", () => {
    assert.throws(
      () => validateConfig(withCopyOnWorktree(["/etc/passwd"]), "test"),
      /must be a relative path/,
    );
  });

  it("rejects traversal with '..'", () => {
    assert.throws(
      () => validateConfig(withCopyOnWorktree(["../leak"]), "test"),
      /must be a relative path/,
    );
  });

  it("rejects traversal even when '..' is nested", () => {
    assert.throws(
      () => validateConfig(withCopyOnWorktree(["foo/../bar"]), "test"),
      /must be a relative path/,
    );
  });
});
