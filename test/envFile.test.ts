import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnvText, readEnvFile } from "../src/envFile.js";
import { validateConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

describe("parseEnvText", () => {
  it("parses basic KEY=value", () => {
    const r = parseEnvText("DB_HOST=localhost\nDB_PORT=5432\n");
    assert.deepEqual(r, { DB_HOST: "localhost", DB_PORT: "5432" });
  });

  it("skips blank lines and comments", () => {
    const r = parseEnvText([
      "# top comment",
      "",
      "KEY=value",
      "  # indented comment",
      "",
      "OTHER=x",
    ].join("\n"));
    assert.deepEqual(r, { KEY: "value", OTHER: "x" });
  });

  it("handles double-quoted values (preserves spaces, hash, equals)", () => {
    const r = parseEnvText('GREETING="hello world"\nWEIRD="a # b = c"\n');
    assert.equal(r.GREETING, "hello world");
    assert.equal(r.WEIRD, "a # b = c");
  });

  it("handles single-quoted values", () => {
    const r = parseEnvText("PATH='/usr/local/bin:/usr/bin'\n");
    assert.equal(r.PATH, "/usr/local/bin:/usr/bin");
  });

  it("strips the optional `export ` prefix", () => {
    const r = parseEnvText("export KEY=value\nexport OTHER='x'\n");
    assert.deepEqual(r, { KEY: "value", OTHER: "x" });
  });

  it("trims whitespace around unquoted values", () => {
    const r = parseEnvText("KEY=  value  \n");
    assert.equal(r.KEY, "value");
  });

  it("treats only matching quote pairs as quoted", () => {
    // Unmatched quote → not treated as quoted, used as literal
    const r = parseEnvText(`MIXED="oops\nOK="fine"\n`);
    assert.equal(r.MIXED, `"oops`);
    assert.equal(r.OK, "fine");
  });

  it("accepts empty values", () => {
    const r = parseEnvText("EMPTY=\nQUOTED_EMPTY=\"\"\n");
    assert.equal(r.EMPTY, "");
    assert.equal(r.QUOTED_EMPTY, "");
  });

  it("warns and skips lines without '='", () => {
    const warnings: string[] = [];
    const r = parseEnvText("just_a_line\nKEY=value\n", {
      onWarn: (m) => warnings.push(m),
    });
    assert.deepEqual(r, { KEY: "value" });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /no '='/);
  });

  it("warns and skips invalid keys (digit-start, dashes)", () => {
    const warnings: string[] = [];
    const r = parseEnvText("1BAD=value\nWITH-DASH=value\nGOOD=ok\n", {
      onWarn: (m) => warnings.push(m),
    });
    assert.deepEqual(r, { GOOD: "ok" });
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((w) => /invalid key/.test(w)));
  });

  it("returns last wins on duplicate keys (matches shell behavior)", () => {
    const r = parseEnvText("KEY=first\nKEY=second\n");
    assert.equal(r.KEY, "second");
  });

  it("treats inline `#` as part of unquoted value (matches dotenv)", () => {
    // Standard dotenv behavior — to use comments, put them on their own line
    // or quote the value.
    const r = parseEnvText("KEY=value # inline\n");
    assert.equal(r.KEY, "value # inline");
  });

  it("returns empty object for empty input", () => {
    assert.deepEqual(parseEnvText(""), {});
    assert.deepEqual(parseEnvText("\n\n\n"), {});
  });
});

describe("readEnvFile", () => {
  it("reads and parses a real file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "banyan-env-"));
    try {
      writeFileSync(path.join(dir, ".env"), "A=1\nB=two\n");
      const r = readEnvFile(path.join(dir, ".env"));
      assert.deepEqual(r, { A: "1", B: "two" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns and returns {} when the file is missing", () => {
    const warnings: string[] = [];
    const r = readEnvFile("/nope/nope/nope", { onWarn: (m) => warnings.push(m) });
    assert.deepEqual(r, {});
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /not found/);
  });
});

// ── Schema validation ─────────────────────────────────────────────────────

function withLoadEnvFiles(entries: unknown): unknown {
  return {
    version: 1,
    projects: [
      {
        name: "p",
        repos: [{ name: "r", path: "/tmp/p/r", loadEnvFiles: entries }],
      },
    ],
  };
}

describe("validateConfig loadEnvFiles", () => {
  it("accepts a list of relative paths", () => {
    const cfg = validateConfig(
      withLoadEnvFiles([".env.local", "config/.env.test"]),
      "test",
    );
    assert.deepEqual(
      cfg.projects[0]!.repos[0]!.loadEnvFiles,
      [".env.local", "config/.env.test"],
    );
  });

  it("treats an empty list as 'not set'", () => {
    const cfg = validateConfig(withLoadEnvFiles([]), "test");
    assert.equal(cfg.projects[0]!.repos[0]!.loadEnvFiles, undefined);
  });

  it("rejects absolute paths", () => {
    assert.throws(
      () => validateConfig(withLoadEnvFiles(["/etc/secrets"]), "test"),
      /must be a relative path/,
    );
  });

  it("rejects '..' traversal", () => {
    assert.throws(
      () => validateConfig(withLoadEnvFiles(["../leak"]), "test"),
      /must be a relative path/,
    );
  });

  it("rejects non-array values", () => {
    assert.throws(
      () => validateConfig(withLoadEnvFiles(".env"), "test"),
      ConfigError,
    );
  });

  it("rejects empty string entries", () => {
    assert.throws(
      () => validateConfig(withLoadEnvFiles([""]), "test"),
      ConfigError,
    );
  });

  it("can coexist with copyOnWorktree on the same repo", () => {
    const cfg = validateConfig(
      {
        version: 1,
        projects: [
          {
            name: "p",
            repos: [
              {
                name: "r",
                path: "/tmp/p/r",
                copyOnWorktree: [".env.local"],
                loadEnvFiles: [".env.local"],
              },
            ],
          },
        ],
      },
      "test",
    );
    const r = cfg.projects[0]!.repos[0]!;
    assert.deepEqual(r.copyOnWorktree, [".env.local"]);
    assert.deepEqual(r.loadEnvFiles, [".env.local"]);
  });
});
