import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  worktreePath,
  branchName,
  windowName,
  sessionName,
  agentsWindowName,
} from "../src/naming.js";

describe("naming", () => {
  it("worktreePath appends feature to repo path with dash", () => {
    assert.equal(
      worktreePath("/home/u/IdeaProjects/Server", "login"),
      "/home/u/IdeaProjects/Server-login",
    );
  });

  it("branchName prepends feature/ prefix", () => {
    assert.equal(branchName("login"), "feature/login");
  });

  it("windowName joins target and feature with dash", () => {
    assert.equal(windowName("back", "login"), "back-login");
  });

  it("sessionName equals the project name", () => {
    assert.equal(sessionName("frontend-app"), "frontend-app");
  });

  it("worktreePath handles feature with dashes", () => {
    assert.equal(
      worktreePath("/repo/path", "add-login-form"),
      "/repo/path-add-login-form",
    );
  });

  it("agentsWindowName prefixes project name with 'agents-'", () => {
    assert.equal(agentsWindowName("frontend-app"), "agents-frontend-app");
    assert.equal(agentsWindowName("my-app"), "agents-my-app");
  });
});
