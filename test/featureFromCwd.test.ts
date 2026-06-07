import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveFeatureFromCwd } from "../src/location.js";
import type { Config } from "../src/config.js";

// Verify the cwd → feature inference used by per-project commands (stop,
// merge, rebase, cleanup, approve, todo, wt-rm, env up/down/recreate/logs).

let baseDir: string;
let repoPath: string;
let worktreeRoot: string;
let cfg: Config;
const ORIGINAL_CWD = process.cwd();

before(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "banyan-feat-"));
  repoPath = path.join(baseDir, "MyApp", "front");
  // New worktree layout: <parent>/worktree-<basename>/<feature>
  worktreeRoot = path.join(baseDir, "MyApp", "worktree-front", "login-flow");
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(worktreeRoot, { recursive: true });

  cfg = {
    version: 1,
    projects: [
      {
        name: "myproject",
        repos: [{ name: "front", path: repoPath }],
      },
    ],
  };
});

after(() => {
  process.chdir(ORIGINAL_CWD);
  rmSync(baseDir, { recursive: true, force: true });
});

describe("resolveFeatureFromCwd", () => {
  it("returns the explicit feature when provided, ignoring cwd", () => {
    process.chdir(repoPath); // not in a worktree
    const result = resolveFeatureFromCwd(cfg, "myproject", "explicit-feat", "merge");
    assert.equal(result, "explicit-feat");
  });

  it("infers the feature from cwd when inside a worktree", () => {
    process.chdir(worktreeRoot);
    const result = resolveFeatureFromCwd(cfg, "myproject", undefined, "merge");
    assert.equal(result, "login-flow");
  });

  it("throws UsageError when no feature given and cwd is the main repo", () => {
    process.chdir(repoPath);
    assert.throws(
      () => resolveFeatureFromCwd(cfg, "myproject", undefined, "merge"),
      /no <feature> given/,
    );
  });

  it("throws UsageError when cwd is in a different project's worktree", () => {
    process.chdir(worktreeRoot);
    assert.throws(
      () => resolveFeatureFromCwd(cfg, "other-project", undefined, "merge"),
      /no <feature> given/,
    );
  });
});
