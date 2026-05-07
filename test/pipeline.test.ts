import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

let originalHome: string | undefined;
let tmpHome: string;
let repoPath: string;

before(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), "banyan-pipeline-test-"));
  process.env.HOME = tmpHome;
  // Resolve the canonical path on macOS where /var ↔ /private/var. Git
  // returns canonical paths in `worktree list`, so we have to match.
  tmpHome = realpathSync(tmpHome);
  process.env.HOME = tmpHome;
  // Make a real bare repo so git worktree calls don't fail.
  repoPath = path.join(tmpHome, "demo-repo");
  execFileSync("git", ["init", "-q", "--initial-branch=main", repoPath]);
  execFileSync("git", ["-C", repoPath, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", repoPath, "config", "user.name", "t"]);
  execFileSync("git", ["-C", repoPath, "commit", "--allow-empty", "-m", "init", "-q"]);
});

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

const STATE_DIR = path.join(tmpHome!, ".config", "banyan", "state");

const pipelineMod = await import("../src/dashboard/pipeline.js");
const todoMod = await import("../src/todo.js");
const approvalMod = await import("../src/approval.js");
const reportsMod = await import("../src/reports.js");

const { buildPipeline } = pipelineMod;
const { setTodo, markTodoDone } = todoMod;
const { requestApproval, approvePlan, rejectPlan } = approvalMod;
const { appendReport } = reportsMod;

function project() {
  return {
    name: "demo",
    repos: [{ name: "main", path: repoPath } as any],
  };
}

function makeWorktree(feature: string): string {
  const wtRoot = path.join(path.dirname(repoPath), `worktree-${path.basename(repoPath)}`);
  const wtPath = path.join(wtRoot, feature);
  execFileSync("git", [
    "-C", repoPath,
    "worktree", "add", wtPath, "-b", `feature/${feature}`,
  ], { stdio: ["ignore", "ignore", "ignore"] });
  return wtPath;
}

describe("dashboard/pipeline", () => {
  beforeEach(() => {
    if (existsSync(STATE_DIR)) rmSync(STATE_DIR, { recursive: true, force: true });
    // Clean up any worktrees from the previous test.
    try {
      const list = execFileSync("git", ["-C", repoPath, "worktree", "list", "--porcelain"]).toString();
      for (const line of list.split("\n")) {
        if (line.startsWith("worktree ")) {
          const p = line.slice("worktree ".length);
          if (p !== repoPath) {
            execFileSync("git", ["-C", repoPath, "worktree", "remove", "--force", p], { stdio: ["ignore", "ignore", "ignore"] });
          }
        }
      }
    } catch { /* ignore */ }
  });

  it("worktree only → stage = created", async () => {
    makeWorktree("alpha");
    const entries = await buildPipeline(project() as any);
    const e = entries.find((x) => x.feature === "alpha")!;
    assert.equal(e.stage, "created");
    assert.equal(e.stageIndex, 0);
    assert.deepEqual(e.repos, ["main"]);
  });

  it("with todo, no approval state → working (todo means you're working)", async () => {
    makeWorktree("beta");
    setTodo("demo", "beta", ["a", "b"]);
    const entries = await buildPipeline(project() as any);
    const e = entries.find((x) => x.feature === "beta")!;
    assert.equal(e.stage, "working");
  });

  it("approval pending → approval", async () => {
    makeWorktree("gamma");
    setTodo("demo", "gamma", ["a"]);
    requestApproval("demo", "gamma");
    const entries = await buildPipeline(project() as any);
    const e = entries.find((x) => x.feature === "gamma")!;
    assert.equal(e.stage, "approval");
  });

  it("approval approved + todo not done → working", async () => {
    makeWorktree("delta");
    setTodo("demo", "delta", ["a", "b"]);
    requestApproval("demo", "delta");
    approvePlan("demo", "delta");
    const entries = await buildPipeline(project() as any);
    const e = entries.find((x) => x.feature === "delta")!;
    assert.equal(e.stage, "working");
  });

  it("done report + todo complete → reported", async () => {
    makeWorktree("epsilon");
    setTodo("demo", "epsilon", ["a"]);
    markTodoDone("demo", "epsilon", ["1"]);
    appendReport("demo", "epsilon", { status: "done", summary: "ok", testInstructions: "x" });
    const entries = await buildPipeline(project() as any);
    const e = entries.find((x) => x.feature === "epsilon")!;
    assert.equal(e.stage, "reported");
  });

  it("blocked report → flag = blocked, stage stays at working", async () => {
    makeWorktree("zeta");
    setTodo("demo", "zeta", ["a", "b"]);
    requestApproval("demo", "zeta");
    approvePlan("demo", "zeta");
    appendReport("demo", "zeta", { status: "blocked", summary: "stuck", testInstructions: "x" });
    const entries = await buildPipeline(project() as any);
    const e = entries.find((x) => x.feature === "zeta")!;
    assert.equal(e.flag, "blocked");
    assert.equal(e.stage, "working");
  });

  it("rejected approval → flag = rejected, stage = planning", async () => {
    makeWorktree("eta");
    setTodo("demo", "eta", ["a"]);
    requestApproval("demo", "eta");
    rejectPlan("demo", "eta", "missing X");
    const entries = await buildPipeline(project() as any);
    const e = entries.find((x) => x.feature === "eta")!;
    assert.equal(e.flag, "rejected");
    assert.equal(e.stage, "planning");
  });

  it("no worktree but report exists → merged", async () => {
    appendReport("demo", "theta", { status: "done", summary: "ok", testInstructions: "x" });
    const entries = await buildPipeline(project() as any);
    const e = entries.find((x) => x.feature === "theta")!;
    assert.equal(e.stage, "merged");
    assert.equal(e.stageIndex, 5);
    assert.deepEqual(e.repos, []);
  });

  it("entries are sorted by stage (in-progress first), then alpha", async () => {
    makeWorktree("aaa");
    makeWorktree("bbb");
    setTodo("demo", "bbb", ["x"]);
    appendReport("demo", "ccc", { status: "done", summary: "ok", testInstructions: "x" }); // merged
    const entries = await buildPipeline(project() as any);
    const order = entries.map((e) => e.feature);
    // aaa is "created" (idx 0), bbb is "working" (idx 3), ccc is "merged" (idx 5)
    assert.deepEqual(order, ["aaa", "bbb", "ccc"]);
  });
});
