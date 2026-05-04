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
  windowName,
  sessionName,
  agentsWindowName,
  orchestratorWindowName,
} from "../src/naming.js";

describe("naming — basic", () => {
  it("branchName prepends feature/ prefix", () => {
    assert.equal(branchName("login"), "feature/login");
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
      worktreePath("/home/u/IdeaProjects/Server", "login"),
      "/home/u/IdeaProjects/worktree-Server/login",
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
      legacyWorktreePath("/home/u/IdeaProjects/Server", "login"),
      "/home/u/IdeaProjects/Server-login",
    );
  });
});

describe("naming — parseWorktreePath", () => {
  const repoPath = "/home/u/Dev/Server";

  it("detects new layout root", () => {
    assert.deepEqual(
      parseWorktreePath("/home/u/Dev/worktree-Server/login", repoPath),
      { feature: "login" },
    );
  });

  it("detects new layout subdir", () => {
    assert.deepEqual(
      parseWorktreePath("/home/u/Dev/worktree-Server/login/src/main", repoPath),
      { feature: "login" },
    );
  });

  it("detects legacy layout root", () => {
    assert.deepEqual(
      parseWorktreePath("/home/u/Dev/Server-login", repoPath),
      { feature: "login" },
    );
  });

  it("detects legacy layout subdir", () => {
    assert.deepEqual(
      parseWorktreePath("/home/u/Dev/Server-login/src/main", repoPath),
      { feature: "login" },
    );
  });

  it("handles features with dashes in legacy layout", () => {
    assert.deepEqual(
      parseWorktreePath("/home/u/Dev/Server-add-login-form", repoPath),
      { feature: "add-login-form" },
    );
  });

  it("returns undefined for unrelated paths", () => {
    assert.equal(parseWorktreePath("/tmp/foo", repoPath), undefined);
    assert.equal(parseWorktreePath("/home/u/Dev/Other", repoPath), undefined);
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
