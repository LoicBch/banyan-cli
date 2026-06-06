import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import {
  listFsEntries,
  probePath,
  createProject,
  listTechProfiles,
} from "../src/dashboard/wizard.js";
import { ConfigError } from "../src/errors.js";

// All filesystem operations refuse paths outside $HOME. To exercise them we
// need a sandbox inside $HOME; tmpdir() is platform-dependent and often lands
// outside (/tmp on macOS, etc.). Use a hidden dir under $HOME we clean up.
const SANDBOX_ROOT = path.join(homedir(), ".banyan-test-wizard");

describe("listFsEntries", () => {
  before(() => {
    rmSync(SANDBOX_ROOT, { recursive: true, force: true });
    mkdirSync(path.join(SANDBOX_ROOT, "front"), { recursive: true });
    mkdirSync(path.join(SANDBOX_ROOT, "back"), { recursive: true });
    mkdirSync(path.join(SANDBOX_ROOT, "back", ".git"), { recursive: true });
    writeFileSync(path.join(SANDBOX_ROOT, ".hidden-file"), "");
    mkdirSync(path.join(SANDBOX_ROOT, ".hidden-dir"), { recursive: true });
  });

  after(() => {
    rmSync(SANDBOX_ROOT, { recursive: true, force: true });
  });

  it("returns sorted directories only, skipping hidden entries", () => {
    const r = listFsEntries(SANDBOX_ROOT);
    const names = r.entries.map((e) => e.name);
    assert.deepEqual(names, ["back", "front"]);
  });

  it("flags directories that contain .git as git repos", () => {
    const r = listFsEntries(SANDBOX_ROOT);
    const back = r.entries.find((e) => e.name === "back");
    const front = r.entries.find((e) => e.name === "front");
    assert.equal(back?.isGitRepo, true);
    assert.equal(front?.isGitRepo, false);
  });

  it("rejects paths outside $HOME", () => {
    assert.throws(() => listFsEntries("/tmp"), ConfigError);
    assert.throws(() => listFsEntries("/"), ConfigError);
  });

  it("rejects parent traversal that lands outside $HOME", () => {
    // $HOME/../../etc — resolves outside home.
    const escape = path.join(homedir(), "..", "..", "etc");
    assert.throws(() => listFsEntries(escape), ConfigError);
  });

  it("rejects non-existent paths", () => {
    assert.throws(() => listFsEntries(path.join(SANDBOX_ROOT, "nope")), ConfigError);
  });

  it("expands ~/ shorthand", () => {
    const r = listFsEntries("~/.banyan-test-wizard");
    assert.equal(r.path, SANDBOX_ROOT);
  });

  it("at $HOME, parent is null (can't go higher)", () => {
    const r = listFsEntries(homedir());
    assert.equal(r.parent, null);
  });

  it("below $HOME, parent points one level up", () => {
    const r = listFsEntries(SANDBOX_ROOT);
    assert.equal(r.parent, homedir());
  });
});

describe("probePath", () => {
  before(() => {
    rmSync(SANDBOX_ROOT, { recursive: true, force: true });
    // Node-flavoured repo
    const nodeRepo = path.join(SANDBOX_ROOT, "node-app");
    mkdirSync(path.join(nodeRepo, ".git"), { recursive: true });
    writeFileSync(
      path.join(nodeRepo, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );

    // Unrecognised but valid
    mkdirSync(path.join(SANDBOX_ROOT, "blank"), { recursive: true });
  });

  after(() => {
    rmSync(SANDBOX_ROOT, { recursive: true, force: true });
  });

  it("flags an invalid path", () => {
    const r = probePath(path.join(SANDBOX_ROOT, "nope"));
    assert.equal(r.valid, false);
    assert.ok(r.error);
  });

  it("flags paths outside $HOME", () => {
    const r = probePath("/etc");
    assert.equal(r.valid, false);
  });

  it("detects a node repo, suggests 'node' tech, returns run defaults", () => {
    const r = probePath(path.join(SANDBOX_ROOT, "node-app"));
    assert.equal(r.valid, true);
    assert.equal(r.isGitRepo, true);
    assert.equal(r.suggestedName, "node-app");
    assert.equal(r.suggestedTech, "node");
    assert.ok(r.suggestedRun?.command);
    assert.equal(r.suggestedRun?.port, 3000);
    assert.equal(r.suggestedRun?.portEnv, "PORT");
    assert.equal(r.stackLabel, "node + npm");
  });

  it("returns null tech / null run on an unrecognised dir but stays valid", () => {
    const r = probePath(path.join(SANDBOX_ROOT, "blank"));
    assert.equal(r.valid, true);
    assert.equal(r.suggestedTech, null);
    assert.equal(r.suggestedRun, null);
  });

  it("expands ~/ shorthand", () => {
    const r = probePath("~/.banyan-test-wizard/node-app");
    assert.equal(r.valid, true);
    assert.equal(r.path, path.join(SANDBOX_ROOT, "node-app"));
  });
});

describe("createProject", () => {
  // A fresh temp config dir per test so writes don't interfere with each other
  // or with the user's real config.
  let tmpDir: string;
  let configPath: string;
  let repoPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "banyan-wiz-"));
    configPath = path.join(tmpDir, "config.yaml");
    // Repo path used by createProject's existsSync check — must be under
    // $HOME and exist.
    repoPath = path.join(homedir(), ".banyan-test-wizard", "front");
    mkdirSync(repoPath, { recursive: true });
  });

  after(() => {
    rmSync(SANDBOX_ROOT, { recursive: true, force: true });
  });

  it("writes a minimal project to a fresh config", async () => {
    await createProject(
      {
        name: "demo",
        repos: [
          { name: "front", path: repoPath, tech: "node", run: { command: "npm run dev", port: 3000, portEnv: "PORT" } },
        ],
      },
      configPath,
    );
    const written = readFileSync(configPath, "utf8");
    assert.match(written, /name: demo/);
    assert.match(written, /name: front/);
    assert.match(written, /tech: node/);
    assert.match(written, /command: npm run dev/);
  });

  it("appends to an existing config preserving comments", async () => {
    const original = [
      "# This is a hand-edited config.",
      "version: 1",
      "projects:",
      "  - name: existing",
      "    repos:",
      "      # A comment we want to keep",
      "      - name: web",
      "        path: ~/.banyan-test-wizard/front",
      "        baseBranch: main",
      "",
    ].join("\n");
    writeFileSync(configPath, original, "utf8");

    await createProject(
      {
        name: "demo",
        repos: [{ name: "front", path: repoPath, tech: "node", run: { command: "npm run dev" } }],
      },
      configPath,
    );

    const written = readFileSync(configPath, "utf8");
    assert.match(written, /# This is a hand-edited config\./, "top-of-file comment preserved");
    assert.match(written, /# A comment we want to keep/, "inner comment preserved");
    assert.match(written, /name: existing/, "existing project preserved");
    assert.match(written, /name: demo/, "new project appended");
  });

  it("rejects a duplicate project name", async () => {
    await createProject(
      { name: "demo", repos: [{ name: "front", path: repoPath, tech: "node", run: { command: "npm run dev" } }] },
      configPath,
    );
    await assert.rejects(
      () => createProject(
        { name: "demo", repos: [{ name: "front", path: repoPath, tech: "node", run: { command: "npm run dev" } }] },
        configPath,
      ),
      /already exists/,
    );
  });

  it("rejects an invalid project name", async () => {
    await assert.rejects(
      () => createProject(
        { name: "bad name with spaces", repos: [{ name: "f", path: repoPath, tech: "node", run: { command: "npm run dev" } }] },
        configPath,
      ),
      /must match/,
    );
  });

  it("rejects an empty repos list", async () => {
    await assert.rejects(
      () => createProject({ name: "demo", repos: [] }, configPath),
      /at least one repo/,
    );
  });

  it("rejects duplicate repo names", async () => {
    await assert.rejects(
      () => createProject(
        {
          name: "demo",
          repos: [
            { name: "front", path: repoPath, tech: "node", run: { command: "npm run dev" } },
            { name: "front", path: repoPath, tech: "node", run: { command: "npm run dev" } },
          ],
        },
        configPath,
      ),
      /duplicate repo/,
    );
  });

  it("rejects a non-existent repo path", async () => {
    await assert.rejects(
      () => createProject(
        {
          name: "demo",
          repos: [{ name: "f", path: path.join(homedir(), ".banyan-test-wizard", "missing"), tech: "node", run: { command: "x" } }],
        },
        configPath,
      ),
      /does not exist/,
    );
  });

  it("rejects an unknown tech id", async () => {
    await assert.rejects(
      () => createProject(
        { name: "demo", repos: [{ name: "f", path: repoPath, tech: "rust", run: { command: "cargo run" } }] },
        configPath,
      ),
      /unknown tech/,
    );
  });

  it("contracts the repo path with ~ on write", async () => {
    await createProject(
      { name: "demo", repos: [{ name: "front", path: repoPath, tech: "node", run: { command: "npm run dev" } }] },
      configPath,
    );
    const written = readFileSync(configPath, "utf8");
    assert.match(written, /path: ~\/\.banyan-test-wizard\/front/);
  });
});

describe("listTechProfiles", () => {
  it("returns serialisable snapshot of every profile", () => {
    const profiles = listTechProfiles();
    assert.ok(profiles.length >= 5);
    // No circular refs, fully JSON-safe.
    const round = JSON.parse(JSON.stringify(profiles));
    assert.equal(round[0].id, profiles[0].id);
  });
});
