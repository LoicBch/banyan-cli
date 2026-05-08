import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let originalHome: string | undefined;
let tmpHome: string;

before(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), "banyan-agentstate-test-"));
  process.env.HOME = tmpHome;
});

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

const mod = await import("../src/agentState.js");
const { writeAgentState, readAgentState, deleteAgentState } = mod;

const STATE_DIR = path.join(tmpHome!, ".config", "banyan", "state");

describe("agentState", () => {
  beforeEach(() => {
    if (existsSync(STATE_DIR)) {
      rmSync(STATE_DIR, { recursive: true, force: true });
    }
  });

  it("write + read round-trip", () => {
    writeAgentState({
      project: "demo",
      feature: "login",
      mode: "autonomous",
    });
    const got = readAgentState("demo", "login");
    assert.ok(got);
    assert.equal(got!.mode, "autonomous");
    assert.equal(got!.requireApproval, undefined);
    assert.match(got!.createdAt, /^\d{4}-/);
  });

  it("preserves requireApproval", () => {
    writeAgentState({
      project: "demo",
      feature: "f",
      mode: "autopilot",
      requireApproval: true,
    });
    const got = readAgentState("demo", "f");
    assert.equal(got!.mode, "autopilot");
    assert.equal(got!.requireApproval, true);
  });

  it("read returns undefined for unknown feature", () => {
    assert.equal(readAgentState("demo", "ghost"), undefined);
  });

  it("preserves createdAt across updates", async () => {
    const first = writeAgentState({ project: "p", feature: "f", mode: "interactive" });
    await new Promise((r) => setTimeout(r, 5));
    const second = writeAgentState({ project: "p", feature: "f", mode: "autopilot" });
    assert.equal(second.createdAt, first.createdAt);
    assert.notEqual(second.updatedAt, first.updatedAt);
    assert.equal(second.mode, "autopilot");
  });

  it("delete removes the file", () => {
    writeAgentState({ project: "p", feature: "f", mode: "autonomous" });
    assert.ok(readAgentState("p", "f"));
    deleteAgentState("p", "f");
    assert.equal(readAgentState("p", "f"), undefined);
  });

  it("delete is idempotent", () => {
    assert.doesNotThrow(() => deleteAgentState("p", "ghost"));
  });

  it("scopes per (project, feature)", () => {
    writeAgentState({ project: "alpha", feature: "x", mode: "autonomous" });
    writeAgentState({ project: "beta", feature: "x", mode: "autopilot" });
    assert.equal(readAgentState("alpha", "x")!.mode, "autonomous");
    assert.equal(readAgentState("beta", "x")!.mode, "autopilot");
  });
});
