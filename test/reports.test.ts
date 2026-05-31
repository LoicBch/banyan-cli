import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// reports.ts hard-codes ~/.config/banyan/state. Override HOME to a tmp dir
// before importing so writes land somewhere disposable.
let originalHome: string | undefined;
let tmpHome: string;

before(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), "banyan-reports-test-"));
  process.env.HOME = tmpHome;
});

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

const reportsModule = await import("../src/reports.js");
const { appendReport, readReports } = reportsModule;

const STATE_DIR = path.join(tmpHome!, ".config", "banyan", "state");

describe("reports", () => {
  beforeEach(() => {
    if (existsSync(STATE_DIR)) {
      rmSync(STATE_DIR, { recursive: true, force: true });
    }
  });

  it("appendReport + readReports round-trips a single report", () => {
    appendReport("demo", "login", {
      status: "done",
      summary: "did the thing",
      testInstructions: "click the button",
    });
    const all = readReports("demo");
    assert.equal(all.length, 1);
    assert.equal(all[0]!.project, "demo");
    assert.equal(all[0]!.feature, "login");
    assert.equal(all[0]!.status, "done");
    assert.equal(all[0]!.summary, "did the thing");
    assert.match(all[0]!.ts, /^\d{4}-\d{2}-\d{2}T/); // ISO 8601-ish
  });

  it("readReports returns [] when no file exists", () => {
    assert.deepEqual(readReports("demo"), []);
  });

  it("preserves submission order", () => {
    appendReport("demo", "a", { status: "done", summary: "1", testInstructions: "x" });
    appendReport("demo", "b", { status: "blocked", summary: "2", testInstructions: "x" });
    appendReport("demo", "c", { status: "needs_review", summary: "3", testInstructions: "x" });
    const all = readReports("demo");
    assert.deepEqual(all.map((r) => r.feature), ["a", "b", "c"]);
  });

  it("filters by feature", () => {
    appendReport("demo", "a", { status: "done", summary: "1", testInstructions: "x" });
    appendReport("demo", "b", { status: "done", summary: "2", testInstructions: "x" });
    appendReport("demo", "a", { status: "needs_review", summary: "3", testInstructions: "x" });
    const onlyA = readReports("demo", { feature: "a" });
    assert.equal(onlyA.length, 2);
    assert.ok(onlyA.every((r) => r.feature === "a"));
  });

  it("filters by since (ISO timestamp)", () => {
    appendReport("demo", "a", { status: "done", summary: "1", testInstructions: "x" });
    const cutoff = new Date(Date.now() + 1).toISOString(); // future cutoff
    appendReport("demo", "b", { status: "done", summary: "2", testInstructions: "x" });
    const after = readReports("demo", { since: cutoff });
    assert.ok(
      after.length <= 1,
      "since=future should drop the older entry; same-ms entries acceptable",
    );
  });

  it("latestOnly collapses to one report per feature", () => {
    appendReport("demo", "a", { status: "done", summary: "v1", testInstructions: "x" });
    appendReport("demo", "b", { status: "done", summary: "1", testInstructions: "x" });
    appendReport("demo", "a", { status: "needs_review", summary: "v2", testInstructions: "x" });
    appendReport("demo", "a", { status: "done", summary: "v3", testInstructions: "x" });
    const latest = readReports("demo", { latestOnly: true });
    assert.equal(latest.length, 2);
    const a = latest.find((r) => r.feature === "a");
    const b = latest.find((r) => r.feature === "b");
    assert.equal(a!.summary, "v3");
    assert.equal(b!.summary, "1");
  });

  it("scopes per project", () => {
    appendReport("alpha", "x", { status: "done", summary: "1", testInstructions: "y" });
    appendReport("beta", "x", { status: "done", summary: "2", testInstructions: "y" });
    assert.equal(readReports("alpha").length, 1);
    assert.equal(readReports("beta").length, 1);
    assert.equal(readReports("alpha")[0]!.summary, "1");
    assert.equal(readReports("beta")[0]!.summary, "2");
  });

  it("skips malformed lines silently", async () => {
    appendReport("demo", "ok", { status: "done", summary: "good", testInstructions: "x" });
    const fs = await import("node:fs");
    fs.appendFileSync(path.join(STATE_DIR, "demo.reports.jsonl"), "not-json\n", "utf8");
    appendReport("demo", "ok2", { status: "done", summary: "also good", testInstructions: "x" });
    const all = readReports("demo");
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((r) => r.feature), ["ok", "ok2"]);
  });

  it("preserves optional fields", () => {
    appendReport("demo", "rich", {
      status: "needs_review",
      summary: "complex change",
      testInstructions: "verify A then B",
      hesitations: ["unsure about caching strategy"],
      openQuestions: ["should we add a feature flag?"],
      risks: ["affects login flow"],
      filesChanged: ["src/auth.ts", "src/cache.ts"],
      commits: [{ sha: "abc1234", message: "wip auth" }],
    });
    const r = readReports("demo")[0]!;
    assert.deepEqual(r.hesitations, ["unsure about caching strategy"]);
    assert.deepEqual(r.commits, [{ sha: "abc1234", message: "wip auth" }]);
    assert.deepEqual(r.filesChanged, ["src/auth.ts", "src/cache.ts"]);
  });
});
