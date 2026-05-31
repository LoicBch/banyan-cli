import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectParentDirs } from "../src/claudeContext.js";
import type { ProjectConfig } from "../src/config.js";

describe("claudeContext — projectParentDirs", () => {
  it("returns parent dir of every non-compose repo", () => {
    const project: ProjectConfig = {
      name: "demo",
      repos: [
        { name: "front", path: "/repos/Dev/Front" },
        { name: "back", path: "/repos/Dev/Back" },
      ],
    };
    const dirs = projectParentDirs(project).sort();
    assert.deepEqual(dirs, ["/repos/Dev"]);
  });

  it("deduplicates parent dirs when multiple repos share one", () => {
    const project: ProjectConfig = {
      name: "demo",
      repos: [
        { name: "a", path: "/repos/Dev/Foo" },
        { name: "b", path: "/repos/Dev/Bar" },
        { name: "c", path: "/repos/Dev/Baz" },
      ],
    };
    const dirs = projectParentDirs(project);
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0], "/repos/Dev");
  });

  it("returns multiple parent dirs when repos live in separate trees", () => {
    const project: ProjectConfig = {
      name: "demo",
      repos: [
        { name: "front", path: "/repos/Documents/Dev/MyApp/Front" },
        { name: "back", path: "/repos/Documents/Dev/MyApp/Spring/Back" },
        { name: "app", path: "/repos/AndroidStudio/Mobile" },
      ],
    };
    const dirs = projectParentDirs(project).sort();
    assert.deepEqual(dirs, [
      "/repos/AndroidStudio",
      "/repos/Documents/Dev/MyApp",
      "/repos/Documents/Dev/MyApp/Spring",
    ]);
  });

  it("skips compose-type repos (they share a path with another repo)", () => {
    const project: ProjectConfig = {
      name: "demo",
      repos: [
        { name: "back", path: "/repos/Dev/Back" },
        { name: "infra", type: "compose", path: "/repos/Dev/Back" },
      ],
    };
    const dirs = projectParentDirs(project);
    assert.deepEqual(dirs, ["/repos/Dev"]);
  });

  it("returns an empty array when project has no git repos", () => {
    const project: ProjectConfig = {
      name: "demo",
      repos: [
        { name: "infra", type: "compose", path: "/repos/Dev/Back" },
      ],
    };
    assert.deepEqual(projectParentDirs(project), []);
  });
});
