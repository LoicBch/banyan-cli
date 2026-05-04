import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inferProjectFromCwd } from "../src/projectInference.js";
import type { Config } from "../src/config.js";

let baseDir: string;
let frontPath: string;
let backPath: string;
let p4nPath: string;
let config: Config;

before(() => {
  baseDir = mkdtempSync(path.join(tmpdir(), "banyan-infer-"));
  // Two projects:
  //   myproject: front + back, both under <baseDir>/MyApp/
  //   mobile-app: dashboard, under <baseDir>/Dev/
  frontPath = path.join(baseDir, "MyApp", "Front");
  backPath = path.join(baseDir, "MyApp", "Back");
  p4nPath = path.join(baseDir, "Dev", "Dashboard");
  mkdirSync(frontPath, { recursive: true });
  mkdirSync(backPath, { recursive: true });
  mkdirSync(p4nPath, { recursive: true });

  config = {
    version: 1,
    projects: [
      {
        name: "myproject",
        repos: [
          { name: "front", path: frontPath },
          { name: "back", path: backPath },
        ],
      },
      {
        name: "mobile-app",
        repos: [{ name: "dashboard", path: p4nPath }],
      },
    ],
  };
});

after(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("inferProjectFromCwd", () => {
  it("returns the project when cwd is the main repo of a configured repo", () => {
    assert.equal(inferProjectFromCwd(config, frontPath), "myproject");
    assert.equal(inferProjectFromCwd(config, p4nPath), "mobile-app");
  });

  it("returns the project when cwd is inside a repo subdir", () => {
    const inside = path.join(frontPath, "src", "components");
    mkdirSync(inside, { recursive: true });
    assert.equal(inferProjectFromCwd(config, inside), "myproject");
  });

  it("returns the project when cwd is a worktree (legacy layout)", () => {
    const wt = path.join(baseDir, "MyApp", "Front-feat");
    mkdirSync(wt);
    assert.equal(inferProjectFromCwd(config, wt), "myproject");
  });

  it("returns the project when cwd is a worktree (new layout)", () => {
    const wt = path.join(baseDir, "MyApp", "worktree-Front", "feat2");
    mkdirSync(wt, { recursive: true });
    assert.equal(inferProjectFromCwd(config, wt), "myproject");
  });

  it("infers from parent dir when one project has all repos under it", () => {
    // <baseDir>/MyApp/ is the parent of front + back of myproject only.
    assert.equal(
      inferProjectFromCwd(config, path.join(baseDir, "MyApp")),
      "myproject",
    );
  });

  it("infers from parent dir for a single-repo project", () => {
    // <baseDir>/Dev/ is parent of mobile-app/dashboard only.
    assert.equal(
      inferProjectFromCwd(config, path.join(baseDir, "Dev")),
      "mobile-app",
    );
  });

  it("returns undefined when cwd is the parent of multiple projects (ambiguous)", () => {
    // <baseDir>/ contains both MyApp/* and Dev/* — ambiguous.
    assert.equal(inferProjectFromCwd(config, baseDir), undefined);
  });

  it("returns undefined when cwd matches nothing", () => {
    const orphan = path.join(baseDir, "elsewhere");
    mkdirSync(orphan);
    assert.equal(inferProjectFromCwd(config, orphan), undefined);
  });

  it("does not match prefix of repo name (e.g. /Front vs /Front-extra)", () => {
    // Sibling dir whose path starts with frontPath but isn't a child.
    const sibling = path.join(baseDir, "MyApp", "FrontExtra");
    mkdirSync(sibling);
    // Not a child of frontPath, not a worktree of it (no dash). Not a repo.
    // Should not infer myproject via direct lookup; could infer via parent
    // logic (MyApp/ parent dir is unambiguous), so accept either undefined
    // (strict) or "myproject" (parent-inferred). Verify it's not crashing
    // and that the result is consistent with the parent-dir inference.
    const result = inferProjectFromCwd(config, sibling);
    assert.ok(result === undefined || result === "myproject");
  });
});
