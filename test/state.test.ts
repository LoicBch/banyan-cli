import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// state.ts hard-codes ~/.config/banyan/state. We override HOME to a tmp dir
// before importing so writes land somewhere disposable.
let originalHome: string | undefined;
let tmpHome: string;

before(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), "banyan-state-test-"));
  process.env.HOME = tmpHome;
});

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

// Re-import after env override so STATE_DIR is computed against the tmp HOME.
const stateModule = await import("../src/state.js");
const {
  writeFeatureState,
  readFeatureState,
  deleteFeatureState,
  listFeatureStates,
} = stateModule;

const STATE_DIR = path.join(tmpHome!, ".config", "banyan", "state");

describe("state", () => {
  beforeEach(() => {
    if (existsSync(STATE_DIR)) {
      rmSync(STATE_DIR, { recursive: true, force: true });
    }
  });

  it("writeFeatureState + readFeatureState round-trips", () => {
    writeFeatureState({
      project: "demo",
      feature: "login",
      lastStartedAt: "2026-01-01T00:00:00Z",
      repos: {
        back: { port: 8081, portEnv: "SERVER_PORT", canonicalPort: 8080 },
        front: { port: 3001, portEnv: "PORT", canonicalPort: 3000 },
      },
    });
    const got = readFeatureState("demo", "login");
    assert.ok(got);
    assert.equal(got!.project, "demo");
    assert.equal(got!.feature, "login");
    assert.equal(got!.repos.back!.port, 8081);
    assert.equal(got!.repos.front!.canonicalPort, 3000);
  });

  it("readFeatureState returns undefined when file is missing", () => {
    assert.equal(readFeatureState("demo", "ghost"), undefined);
  });

  it("readFeatureState returns undefined when file is corrupt", async () => {
    const fs = await import("node:fs");
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, "demo.broken.json"), "not-json", "utf8");
    assert.equal(readFeatureState("demo", "broken"), undefined);
  });

  it("deleteFeatureState removes the file", () => {
    writeFeatureState({
      project: "demo",
      feature: "tmpfeat",
      lastStartedAt: "2026-01-01T00:00:00Z",
      repos: {},
    });
    assert.ok(readFeatureState("demo", "tmpfeat"));
    deleteFeatureState("demo", "tmpfeat");
    assert.equal(readFeatureState("demo", "tmpfeat"), undefined);
  });

  it("listFeatureStates returns features for the project, scoped by prefix", () => {
    writeFeatureState({
      project: "demo",
      feature: "alpha",
      lastStartedAt: "2026-01-01T00:00:00Z",
      repos: {},
    });
    writeFeatureState({
      project: "demo",
      feature: "beta",
      lastStartedAt: "2026-01-01T00:00:00Z",
      repos: {},
    });
    writeFeatureState({
      project: "other",
      feature: "alpha",
      lastStartedAt: "2026-01-01T00:00:00Z",
      repos: {},
    });
    const features = listFeatureStates("demo").sort();
    assert.deepEqual(features, ["alpha", "beta"]);
    assert.deepEqual(listFeatureStates("other"), ["alpha"]);
    assert.deepEqual(listFeatureStates("absent"), []);
  });
});
