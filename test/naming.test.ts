import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  worktreePath,
  legacyWorktreePath,
  existingWorktreePath,
  parseWorktreePath,
  branchName,
  formatBranchName,
  assertValidFeature,
  windowName,
  sessionName,
  agentsWindowName,
  orchestratorWindowName,
} from "../src/naming.js";

describe("naming — basic", () => {
  it("branchName prepends feature/ prefix", () => {
    assert.equal(branchName("login"), "feature/login");
  });

  it("formatBranchName uses default 'feature' prefix when none given", () => {
    assert.equal(formatBranchName("login"), "feature/login");
  });

  it("formatBranchName uses a custom prefix", () => {
    assert.equal(formatBranchName("oauth", "fix"), "fix/oauth");
  });

  it("formatBranchName with empty prefix returns the bare feature", () => {
    assert.equal(formatBranchName("v2.1", ""), "v2.1");
  });

  it("formatBranchName supports multi-segment prefixes", () => {
    assert.equal(formatBranchName("hotfix", "release/v1"), "release/v1/hotfix");
  });

  it("formatBranchName trims trailing slashes from the prefix", () => {
    assert.equal(formatBranchName("foo", "fix/"), "fix/foo");
    assert.equal(formatBranchName("foo", "fix//"), "fix/foo");
  });

  it("assertValidFeature rejects names with '/' and points to --prefix", () => {
    assert.throws(() => assertValidFeature("fix/oauth"), /--prefix/);
  });

  it("assertValidFeature rejects empty names", () => {
    assert.throws(() => assertValidFeature(""), /empty/);
  });

  it("assertValidFeature accepts a plain name", () => {
    assert.doesNotThrow(() => assertValidFeature("login"));
  });

  it("windowName joins target and feature with dash", () => {
    assert.equal(windowName("back", "login"), "back-login");
  });

  it("sessionName equals the project name", () => {
    assert.equal(sessionName("frontend-app"), "frontend-app");
  });

  it("agentsWindowName prefixes project name with 'agents-'", () => {
    assert.equal(agentsWindowName("frontend-app"), "agents-frontend-app");
    assert.equal(agentsWindowName("my-app"), "agents-my-app");
  });

  it("orchestratorWindowName prefixes project name with 'orchestrator-'", () => {
    assert.equal(orchestratorWindowName("frontend-app"), "orchestrator-frontend-app");
  });
});

describe("naming — worktreePath (new layout)", () => {
  it("groups feature worktrees under <parent>/worktree-<basename>", () => {
    assert.equal(
      worktreePath("/repos/IdeaProjects/Server", "login"),
      "/repos/IdeaProjects/worktree-Server/login",
    );
  });

  it("handles feature names with dashes", () => {
    assert.equal(
      worktreePath("/repo/path", "add-login-form"),
      "/repo/worktree-path/add-login-form",
    );
  });

  it("works with paths having a single segment", () => {
    assert.equal(worktreePath("/repo", "login"), "/worktree-repo/login");
  });
});

describe("naming — legacyWorktreePath", () => {
  it("returns the old sibling-dash format", () => {
    assert.equal(
      legacyWorktreePath("/repos/IdeaProjects/Server", "login"),
      "/repos/IdeaProjects/Server-login",
    );
  });
});

describe("naming — parseWorktreePath", () => {
  const repoPath = "/repos/Dev/Server";

  it("detects new layout root", () => {
    assert.deepEqual(
      parseWorktreePath("/repos/Dev/worktree-Server/login", repoPath),
      { feature: "login" },
    );
  });

  it("detects new layout subdir", () => {
    assert.deepEqual(
      parseWorktreePath("/repos/Dev/worktree-Server/login/src/main", repoPath),
      { feature: "login" },
    );
  });

  it("detects legacy layout root", () => {
    assert.deepEqual(
      parseWorktreePath("/repos/Dev/Server-login", repoPath),
      { feature: "login" },
    );
  });

  it("detects legacy layout subdir", () => {
    assert.deepEqual(
      parseWorktreePath("/repos/Dev/Server-login/src/main", repoPath),
      { feature: "login" },
    );
  });

  it("handles features with dashes in legacy layout", () => {
    assert.deepEqual(
      parseWorktreePath("/repos/Dev/Server-add-login-form", repoPath),
      { feature: "add-login-form" },
    );
  });

  it("returns undefined for unrelated paths", () => {
    assert.equal(parseWorktreePath("/tmp/foo", repoPath), undefined);
    assert.equal(parseWorktreePath("/repos/Dev/Other", repoPath), undefined);
  });

  it("does not match the main repo path itself", () => {
    // Main checkout — shouldn't be parsed as a worktree.
    assert.equal(parseWorktreePath(repoPath, repoPath), undefined);
  });
});

describe("naming — existingWorktreePath", () => {
  let baseDir: string;
  before(() => {
    baseDir = mkdtempSync(path.join(tmpdir(), "banyan-naming-"));
  });
  after(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("returns undefined when neither layout exists", () => {
    const repo = path.join(baseDir, "Server");
    mkdirSync(repo);
    assert.equal(existingWorktreePath(repo, "login"), undefined);
  });

  it("returns the new layout path when it exists", () => {
    const repo = path.join(baseDir, "Server");
    const newWt = path.join(baseDir, "worktree-Server", "login");
    mkdirSync(newWt, { recursive: true });
    assert.equal(existingWorktreePath(repo, "login"), newWt);
  });

  it("falls back to the legacy path when only it exists", () => {
    const repo = path.join(baseDir, "Server2");
    mkdirSync(repo);
    const legacyWt = path.join(baseDir, "Server2-feat");
    mkdirSync(legacyWt);
    assert.equal(existingWorktreePath(repo, "feat"), legacyWt);
  });

  it("prefers the new layout over the legacy when both exist", () => {
    const repo = path.join(baseDir, "Server3");
    mkdirSync(repo);
    const newWt = path.join(baseDir, "worktree-Server3", "feat");
    mkdirSync(newWt, { recursive: true });
    const legacyWt = path.join(baseDir, "Server3-feat");
    mkdirSync(legacyWt);
    assert.equal(existingWorktreePath(repo, "feat"), newWt);
  });
});
