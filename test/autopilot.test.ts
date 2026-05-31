import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let originalHome: string | undefined;
let tmpHome: string;

before(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), "banyan-autopilot-test-"));
  process.env.HOME = tmpHome;
});

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

const autopilotMod = await import("../src/autopilot.js");
const todoMod = await import("../src/todo.js");
const reportsMod = await import("../src/reports.js");

const {
  generateAutopilotSettings,
  removeAutopilotSettings,
  autopilotSettingsPath,
  isAutopilotComplete,
} = autopilotMod;
const { setTodo, markTodoDone } = todoMod;
const { appendReport } = reportsMod;

const STATE_DIR = path.join(tmpHome!, ".config", "banyan", "state");

describe("autopilot — settings file", () => {
  beforeEach(() => {
    if (existsSync(STATE_DIR)) {
      rmSync(STATE_DIR, { recursive: true, force: true });
    }
  });

  it("generateAutopilotSettings writes a JSON file with a Stop hook", () => {
    const p = generateAutopilotSettings("p", "feat-x");
    assert.equal(p, autopilotSettingsPath("p", "feat-x"));
    assert.ok(existsSync(p));
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    assert.ok(parsed.hooks?.Stop, "should have Stop hook section");
    const cmd = parsed.hooks.Stop[0].hooks[0].command as string;
    assert.match(cmd, /_autopilot-tick/);
    assert.match(cmd, /\bp\b/);
    assert.match(cmd, /feat-x/);
  });

  it("settings file shell-escapes feature names with hyphens (no quoting needed)", () => {
    const p = generateAutopilotSettings("alpha", "fix-bug-1");
    const cmd = JSON.parse(readFileSync(p, "utf8")).hooks.Stop[0].hooks[0].command as string;
    // hyphens and digits are in the safe charset — no extra quotes around the args
    assert.match(cmd, /_autopilot-tick alpha fix-bug-1/);
  });

  it("removeAutopilotSettings deletes the file", () => {
    const p = generateAutopilotSettings("p", "x");
    assert.ok(existsSync(p));
    removeAutopilotSettings("p", "x");
    assert.ok(!existsSync(p));
  });

  it("removeAutopilotSettings is idempotent (no error if absent)", () => {
    assert.doesNotThrow(() => removeAutopilotSettings("p", "ghost"));
  });
});

describe("autopilot — completion logic", () => {
  beforeEach(() => {
    if (existsSync(STATE_DIR)) {
      rmSync(STATE_DIR, { recursive: true, force: true });
    }
  });

  it("not complete when no report has been submitted", () => {
    const r = isAutopilotComplete("p", "f");
    assert.equal(r.complete, false);
    assert.match(r.reason, /banyan_report_done/);
  });

  it("not complete when report exists but TODO has unfinished items", () => {
    setTodo("p", "f", ["a", "b", "c"]);
    markTodoDone("p", "f", ["1"]);
    appendReport("p", "f", { status: "done", summary: "x", testInstructions: "y" });
    const r = isAutopilotComplete("p", "f");
    assert.equal(r.complete, false);
    assert.match(r.reason, /unfinished/);
    assert.match(r.reason, /\[2\]/);
    assert.match(r.reason, /\[3\]/);
    assert.doesNotMatch(r.reason, /\[1\]/);
  });

  it("complete when TODO is fully done AND a report exists", () => {
    setTodo("p", "f", ["a", "b"]);
    markTodoDone("p", "f", ["1", "2"]);
    appendReport("p", "f", { status: "done", summary: "x", testInstructions: "y" });
    const r = isAutopilotComplete("p", "f");
    assert.equal(r.complete, true);
  });

  it("complete when there's no TODO at all but a report has been submitted", () => {
    // Agent might be in autopilot but legitimately unable to scope a TODO.
    // We require at least the report; an absent TODO is not a blocker.
    appendReport("p", "f", { status: "done", summary: "x", testInstructions: "y" });
    const r = isAutopilotComplete("p", "f");
    assert.equal(r.complete, true);
  });

  it("complete when TODO list is empty (length 0) and report exists", () => {
    setTodo("p", "f", []);
    appendReport("p", "f", { status: "done", summary: "x", testInstructions: "y" });
    const r = isAutopilotComplete("p", "f");
    assert.equal(r.complete, true);
  });

  it("scopes per (project, feature)", () => {
    setTodo("p", "a", ["1"]);
    markTodoDone("p", "a", ["1"]);
    appendReport("p", "a", { status: "done", summary: "x", testInstructions: "y" });
    // Same project, different feature: still incomplete
    setTodo("p", "b", ["2"]);
    const ra = isAutopilotComplete("p", "a");
    const rb = isAutopilotComplete("p", "b");
    assert.equal(ra.complete, true);
    assert.equal(rb.complete, false);
  });
});
