import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectParentDirs } from "../src/claudeContext.js";
import type { ProjectConfig } from "../src/config.js";

describe("claudeContext — projectParentDirs", () => {
  it("returns parent dir of every non-compose repo", () => {
    const project: ProjectConfig = {
      name: "demo",
      repos: [
        { name: "front", path: "/home/u/Dev/Front" },
        { name: "back", path: "/home/u/Dev/Back" },
      ],
    };
    const dirs = projectParentDirs(project).sort();
    assert.deepEqual(dirs, ["/home/u/Dev"]);
  });

  it("deduplicates parent dirs when multiple repos share one", () => {
    const project: ProjectConfig = {
      name: "demo",
      repos: [
        { name: "a", path: "/home/u/Dev/Foo" },
        { name: "b", path: "/home/u/Dev/Bar" },
        { name: "c", path: "/home/u/Dev/Baz" },
      ],
    };
    const dirs = projectParentDirs(project);
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0], "/home/u/Dev");
  });

  it("returns multiple parent dirs when repos live in separate trees", () => {
    const project: ProjectConfig = {
      name: "demo",
      repos: [
        { name: "front", path: "/home/u/Documents/Dev/MyApp/Front" },
        { name: "back", path: "/home/u/Documents/Dev/MyApp/Spring/Back" },
        { name: "app", path: "/home/u/AndroidStudio/Mobile" },
      ],
    };
    const dirs = projectParentDirs(project).sort();
    assert.deepEqual(dirs, [
      "/home/u/AndroidStudio",
      "/home/u/Documents/Dev/MyApp",
      "/home/u/Documents/Dev/MyApp/Spring",
    ]);
  });

  it("skips compose-type repos (they share a path with another repo)", () => {
    const project: ProjectConfig = {
      name: "demo",
      repos: [
        { name: "back", path: "/home/u/Dev/Back" },
        { name: "infra", type: "compose", path: "/home/u/Dev/Back" },
      ],
    };
    const dirs = projectParentDirs(project);
    assert.deepEqual(dirs, ["/home/u/Dev"]);
  });

  it("returns an empty array when project has no git repos", () => {
    const project: ProjectConfig = {
      name: "demo",
      repos: [
        { name: "infra", type: "compose", path: "/home/u/Dev/Back" },
      ],
    };
    assert.deepEqual(projectParentDirs(project), []);
  });
});
