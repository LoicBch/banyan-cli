import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let originalHome: string | undefined;
let tmpHome: string;

before(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), "banyan-approval-test-"));
  process.env.HOME = tmpHome;
});

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

const mod = await import("../src/approval.js");
const {
  requestApproval,
  approvePlan,
  rejectPlan,
  getApproval,
  approvalStatus,
  deleteApproval,
} = mod;

const STATE_DIR = path.join(tmpHome!, ".config", "banyan", "state");

describe("approval", () => {
  beforeEach(() => {
    if (existsSync(STATE_DIR)) {
      rmSync(STATE_DIR, { recursive: true, force: true });
    }
  });

  it("status is no-plan-yet when nothing has been recorded", () => {
    assert.equal(approvalStatus(getApproval("p", "f")), "no-plan-yet");
  });

  it("requestApproval moves to pending", () => {
    const s = requestApproval("p", "f");
    assert.equal(approvalStatus(s), "pending");
    assert.ok(s.planSubmittedAt);
    assert.equal(s.approvedAt, null);
  });

  it("approvePlan moves to approved", () => {
    requestApproval("p", "f");
    const s = approvePlan("p", "f");
    assert.equal(approvalStatus(s), "approved");
    assert.ok(s.approvedAt);
  });

  it("approvePlan throws if no plan was submitted", () => {
    assert.throws(() => approvePlan("p", "f"), /no plan submitted/);
  });

  it("a fresh requestApproval after approval forces re-approval", async () => {
    requestApproval("p", "f");
    approvePlan("p", "f");
    assert.equal(approvalStatus(getApproval("p", "f")), "approved");
    // Wait a tick so the new submission timestamp is strictly after the
    // approval one.
    await new Promise((r) => setTimeout(r, 5));
    requestApproval("p", "f");
    assert.equal(approvalStatus(getApproval("p", "f")), "pending");
  });

  it("rejectPlan moves to rejected and stores the note", () => {
    requestApproval("p", "f");
    const s = rejectPlan("p", "f", "scope is wrong");
    assert.equal(approvalStatus(s), "rejected");
    assert.equal(s.rejectionNote, "scope is wrong");
    assert.equal(s.planSubmittedAt, null);
  });

  it("rejectPlan with no note records '(no reason given)'", () => {
    requestApproval("p", "f");
    const s = rejectPlan("p", "f");
    assert.equal(s.rejectionNote, "(no reason given)");
  });

  it("re-submitting a plan after rejection clears the rejection note", () => {
    requestApproval("p", "f");
    rejectPlan("p", "f", "first plan was bad");
    assert.equal(approvalStatus(getApproval("p", "f")), "rejected");
    requestApproval("p", "f");
    const s = getApproval("p", "f")!;
    assert.equal(approvalStatus(s), "pending");
    assert.equal(s.rejectionNote, null);
  });

  it("deleteApproval removes the file", () => {
    requestApproval("p", "f");
    assert.ok(getApproval("p", "f"));
    deleteApproval("p", "f");
    assert.equal(getApproval("p", "f"), undefined);
  });

  it("scopes per (project, feature)", () => {
    requestApproval("alpha", "x");
    requestApproval("beta", "x");
    approvePlan("alpha", "x");
    assert.equal(approvalStatus(getApproval("alpha", "x")), "approved");
    assert.equal(approvalStatus(getApproval("beta", "x")), "pending");
  });
});

describe("autopilot — approval gate integration", () => {
  beforeEach(() => {
    if (existsSync(STATE_DIR)) {
      rmSync(STATE_DIR, { recursive: true, force: true });
    }
  });

  it("blocks with 'awaiting approval' when plan is pending", async () => {
    const { isAutopilotComplete } = await import("../src/autopilot.js");
    requestApproval("p", "f");
    const r = isAutopilotComplete("p", "f");
    assert.equal(r.complete, false);
    assert.match(r.reason, /awaiting user approval/i);
  });

  it("blocks with rejection note when plan was rejected", async () => {
    const { isAutopilotComplete } = await import("../src/autopilot.js");
    requestApproval("p", "f");
    rejectPlan("p", "f", "missing X step");
    const r = isAutopilotComplete("p", "f");
    assert.equal(r.complete, false);
    assert.match(r.reason, /rejected/i);
    assert.match(r.reason, /missing X step/);
  });

  it("falls through to TODO/report gate when plan is approved", async () => {
    const { isAutopilotComplete } = await import("../src/autopilot.js");
    const { setTodo, markTodoDone } = await import("../src/todo.js");
    const { appendReport } = await import("../src/reports.js");
    requestApproval("p", "f");
    approvePlan("p", "f");
    setTodo("p", "f", ["a"]);
    markTodoDone("p", "f", ["1"]);
    appendReport("p", "f", { status: "done", summary: "x", testInstructions: "y" });
    const r = isAutopilotComplete("p", "f");
    assert.equal(r.complete, true);
  });
});

describe("autopilot — needsSupervisorHook", () => {
  it("true for delegated mode regardless of approval flag", async () => {
    const { needsSupervisorHook } = await import("../src/autopilot.js");
    assert.equal(needsSupervisorHook({ mode: "delegated" }), true);
    assert.equal(needsSupervisorHook({ mode: "delegated", requireApproval: false }), true);
  });

  it("true when requireApproval is set in live mode (legacy opt-in)", async () => {
    const { needsSupervisorHook } = await import("../src/autopilot.js");
    assert.equal(needsSupervisorHook({ mode: "live", requireApproval: true }), true);
  });

  it("false for live mode without requireApproval", async () => {
    const { needsSupervisorHook } = await import("../src/autopilot.js");
    assert.equal(needsSupervisorHook({ mode: "live" }), false);
  });
});
