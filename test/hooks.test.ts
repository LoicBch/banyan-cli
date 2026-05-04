import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let originalHome: string | undefined;
let tmpHome: string;
let tmpRepo: string;

before(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), "banyan-hooks-test-home-"));
  tmpRepo = mkdtempSync(path.join(tmpdir(), "banyan-hooks-test-repo-"));
  process.env.HOME = tmpHome;
});

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpRepo, { recursive: true, force: true });
});

const { findHook, buildHookEnv } = await import("../src/hooks.js");

function writeExec(filePath: string, body: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, body, "utf8");
  chmodSync(filePath, 0o755);
}

describe("hooks — findHook lookup order", () => {
  it("returns null when no hook is installed anywhere", () => {
    assert.equal(findHook(tmpRepo, "worktree_created"), null);
  });

  it("finds .banyan-hooks/<name> in the project main repo (team layer)", () => {
    const target = path.join(tmpRepo, ".banyan-hooks", "worktree_created");
    writeExec(target, "#!/bin/sh\nexit 0\n");
    assert.equal(findHook(tmpRepo, "worktree_created"), target);
    rmSync(target);
  });

  it("falls back to .banyan/hooks/<name> (local layer)", () => {
    const target = path.join(tmpRepo, ".banyan", "hooks", "stack_up");
    writeExec(target, "#!/bin/sh\nexit 0\n");
    assert.equal(findHook(tmpRepo, "stack_up"), target);
    rmSync(target);
  });

  it("falls back to ~/.banyan/hooks/<name> (global layer)", () => {
    const target = path.join(tmpHome, ".banyan", "hooks", "post_merge");
    writeExec(target, "#!/bin/sh\nexit 0\n");
    assert.equal(findHook(tmpRepo, "post_merge"), target);
    rmSync(target);
  });

  it("prefers team over local over global", () => {
    const team = path.join(tmpRepo, ".banyan-hooks", "pre_test");
    const local = path.join(tmpRepo, ".banyan", "hooks", "pre_test");
    const global = path.join(tmpHome, ".banyan", "hooks", "pre_test");
    writeExec(team, "#!/bin/sh\n");
    writeExec(local, "#!/bin/sh\n");
    writeExec(global, "#!/bin/sh\n");
    assert.equal(findHook(tmpRepo, "pre_test"), team);
    rmSync(team);
    assert.equal(findHook(tmpRepo, "pre_test"), local);
    rmSync(local);
    assert.equal(findHook(tmpRepo, "pre_test"), global);
    rmSync(global);
  });

  it("ignores non-executable files (warns but doesn't return them)", () => {
    const target = path.join(tmpRepo, ".banyan-hooks", "post_test");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "#!/bin/sh\n", "utf8");
    chmodSync(target, 0o644); // not executable
    assert.equal(findHook(tmpRepo, "post_test"), null);
    rmSync(target);
  });
});

describe("hooks — buildHookEnv", () => {
  const project = {
    name: "demo",
    repos: [{ name: "back", path: "/repo/back" }],
  };
  const repo = { name: "back", path: "/repo/back" };

  it("includes core BANYAN_* fields", () => {
    const env = buildHookEnv({
      project,
      repo,
      feature: "login",
      worktreePath: "/repo/worktree-back/login",
      branch: "feature/login",
      baseBranch: "develop",
    });
    assert.equal(env.BANYAN_PROJECT, "demo");
    assert.equal(env.BANYAN_FEATURE, "login");
    assert.equal(env.BANYAN_REPO, "back");
    assert.equal(env.BANYAN_REPO_PATH, "/repo/back");
    assert.equal(env.BANYAN_WORKTREE_PATH, "/repo/worktree-back/login");
    assert.equal(env.BANYAN_BRANCH, "feature/login");
    assert.equal(env.BANYAN_BASE_BRANCH, "develop");
  });

  it("omits optional fields when not provided", () => {
    const env = buildHookEnv({ project });
    assert.equal(env.BANYAN_PROJECT, "demo");
    assert.equal(env.BANYAN_FEATURE, undefined);
    assert.equal(env.BANYAN_REPO, undefined);
    assert.equal(env.BANYAN_BRANCH, undefined);
  });
});
