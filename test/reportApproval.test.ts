import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let originalHome: string | undefined;
let tmpHome: string;

before(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), "banyan-rapproval-test-"));
  process.env.HOME = tmpHome;
});

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

const reportsMod = await import("../src/reports.js");
const mod = await import("../src/reportApproval.js");
const { appendReport } = reportsMod;
const {
  approveReport,
  rejectReport,
  getReportApproval,
  reportApprovalStatus,
  deleteReportApproval,
} = mod;

const STATE_DIR = path.join(tmpHome!, ".config", "banyan", "state");

describe("reportApproval", () => {
  beforeEach(() => {
    if (existsSync(STATE_DIR)) rmSync(STATE_DIR, { recursive: true, force: true });
  });

  it("status is no-report-yet when nothing was submitted", () => {
    const r = reportApprovalStatus("p", "f");
    assert.equal(r.status, "no-report-yet");
    assert.equal(r.latestReportTs, null);
  });

  it("status is pending when a report exists with no decision", () => {
    appendReport("p", "f", { status: "done", summary: "x", testInstructions: "y" });
    const r = reportApprovalStatus("p", "f");
    assert.equal(r.status, "pending");
    assert.ok(r.latestReportTs);
  });

  it("approveReport flips status to approved", () => {
    const rep = appendReport("p", "f", { status: "done", summary: "x", testInstructions: "y" });
    approveReport("p", "f", rep.ts);
    assert.equal(reportApprovalStatus("p", "f").status, "approved");
  });

  it("rejectReport flips status to rejected and stores note", () => {
    const rep = appendReport("p", "f", { status: "done", summary: "x", testInstructions: "y" });
    rejectReport("p", "f", rep.ts, "incomplete");
    const r = reportApprovalStatus("p", "f");
    assert.equal(r.status, "rejected");
    assert.equal(r.state?.rejectionNote, "incomplete");
  });

  it("a fresh report after a decision flips status back to pending", async () => {
    const r1 = appendReport("p", "f", { status: "done", summary: "v1", testInstructions: "y" });
    approveReport("p", "f", r1.ts);
    assert.equal(reportApprovalStatus("p", "f").status, "approved");
    await new Promise((r) => setTimeout(r, 5));
    appendReport("p", "f", { status: "done", summary: "v2", testInstructions: "y" });
    assert.equal(reportApprovalStatus("p", "f").status, "pending");
  });

  it("deleteReportApproval removes the file", () => {
    const rep = appendReport("p", "f", { status: "done", summary: "x", testInstructions: "y" });
    approveReport("p", "f", rep.ts);
    assert.ok(getReportApproval("p", "f"));
    deleteReportApproval("p", "f");
    assert.equal(getReportApproval("p", "f"), undefined);
  });

  it("rejectReport with no note records a default", () => {
    const rep = appendReport("p", "f", { status: "done", summary: "x", testInstructions: "y" });
    rejectReport("p", "f", rep.ts);
    const r = reportApprovalStatus("p", "f");
    assert.equal(r.state?.rejectionNote, "(no reason given)");
  });

  it("scopes per (project, feature)", () => {
    const a = appendReport("alpha", "x", { status: "done", summary: "1", testInstructions: "y" });
    appendReport("beta", "x", { status: "done", summary: "2", testInstructions: "y" });
    approveReport("alpha", "x", a.ts);
    assert.equal(reportApprovalStatus("alpha", "x").status, "approved");
    assert.equal(reportApprovalStatus("beta", "x").status, "pending");
  });
});
