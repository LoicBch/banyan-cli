import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let originalHome: string | undefined;
let tmpHome: string;

before(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), "banyan-agentprompt-test-"));
  process.env.HOME = tmpHome;
});

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

const mod = await import("../src/agentPrompt.js");
const {
  ALL_AGENT_MODES,
  loadAgentPromptTemplate,
  renderAgentPrompt,
  buildAgentPrompt,
  ensureProjectPromptFile,
  projectPromptPath,
  getDefaultAgentPrompt,
  resolveMode,
  isAgentMode,
  normalizeMode,
} = mod;

const CONFIG_DIR = path.join(tmpHome!, ".config", "banyan");

describe("agentPrompt", () => {
  beforeEach(() => {
    if (existsSync(CONFIG_DIR)) {
      rmSync(CONFIG_DIR, { recursive: true, force: true });
    }
  });

  it("ALL_AGENT_MODES has live + delegated", () => {
    assert.deepEqual([...ALL_AGENT_MODES], ["live", "delegated"]);
  });

  it("both modes have non-empty defaults (HEADER minimum)", () => {
    for (const m of ["live", "delegated"] as const) {
      const d = getDefaultAgentPrompt(m);
      assert.ok(d.length > 0, `mode ${m} should have default`);
      assert.ok(d.includes("banyan_"), "default mentions banyan_* tools");
    }
  });

  it("live default mentions no report obligation", () => {
    const d = getDefaultAgentPrompt("live");
    // live = conversational, banyan_report_done only on user request
    assert.match(d, /only if the user explicitly asks/i);
  });

  it("delegated default mentions the full pipeline + Stop hook", () => {
    const d = getDefaultAgentPrompt("delegated");
    assert.match(d, /banyan_request_plan_approval/);
    assert.match(d, /banyan_report_done/);
    assert.match(d, /Stop hook/);
  });

  it("loadAgentPromptTemplate returns the default when no file exists", () => {
    assert.equal(loadAgentPromptTemplate("demo", "delegated"), getDefaultAgentPrompt("delegated"));
  });

  it("loadAgentPromptTemplate returns the per-project per-mode file when present", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(projectPromptPath("demo", "delegated"), "custom delegated", "utf8");
    assert.equal(loadAgentPromptTemplate("demo", "delegated"), "custom delegated");
    assert.equal(loadAgentPromptTemplate("demo", "live"), getDefaultAgentPrompt("live"));
  });

  it("loadAgentPromptTemplate ignores empty per-project files", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(projectPromptPath("demo", "delegated"), "   \n  \n", "utf8");
    assert.equal(loadAgentPromptTemplate("demo", "delegated"), getDefaultAgentPrompt("delegated"));
  });

  it("loadAgentPromptTemplate falls back to legacy mode-name files", () => {
    // User has an old `.agentprompt.autonomous.md` from before the rename.
    // It should be picked up when we ask for the new `delegated` mode.
    mkdirSync(CONFIG_DIR, { recursive: true });
    const legacyPath = path.join(CONFIG_DIR, "demo.agentprompt.autonomous.md");
    writeFileSync(legacyPath, "legacy autonomous override", "utf8");
    assert.equal(loadAgentPromptTemplate("demo", "delegated"), "legacy autonomous override");
  });

  it("renderAgentPrompt substitutes placeholders", () => {
    const out = renderAgentPrompt("hello {{project}} / {{feature}}!", {
      project: "p4n",
      feature: "login",
    });
    assert.equal(out, "hello p4n / login!");
  });

  it("buildAgentPrompt always returns a non-empty string (both modes inject HEADER)", () => {
    const live = buildAgentPrompt("p4n", "login", "live");
    const delegated = buildAgentPrompt("p4n", "login", "delegated");
    assert.ok(live.length > 0);
    assert.ok(delegated.length > 0);
    assert.ok(live.includes("'p4n'"));
    assert.ok(delegated.includes("'login'"));
  });

  it("buildAgentPrompt renders + substitutes placeholders", () => {
    const out = buildAgentPrompt("p4n", "login", "delegated");
    assert.ok(out.includes("'p4n'"));
    assert.ok(out.includes("'login'"));
    assert.ok(!out.includes("{{project}}"));
  });

  it("ensureProjectPromptFile creates the file from the default for the mode", () => {
    const p = ensureProjectPromptFile("demo", "live");
    assert.ok(existsSync(p));
    assert.equal(loadAgentPromptTemplate("demo", "live"), getDefaultAgentPrompt("live"));
  });

  it("ensureProjectPromptFile is idempotent (does not overwrite existing)", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(projectPromptPath("demo", "delegated"), "user-edited", "utf8");
    ensureProjectPromptFile("demo", "delegated");
    assert.equal(loadAgentPromptTemplate("demo", "delegated"), "user-edited");
  });

  it("resolveMode: explicit mode wins (new names)", () => {
    assert.equal(resolveMode("delegated", true), "delegated");
    assert.equal(resolveMode("live", true), "live");
  });

  it("resolveMode: legacy explicit names are normalized", () => {
    assert.equal(resolveMode("autopilot", false), "delegated");
    assert.equal(resolveMode("autonomous", false), "delegated");
    assert.equal(resolveMode("interactive", false), "live");
    assert.equal(resolveMode("assisted", false), "live");
  });

  it("resolveMode: defaults to delegated when prompt is given, live otherwise", () => {
    assert.equal(resolveMode(undefined, true), "delegated");
    assert.equal(resolveMode(undefined, false), "live");
  });

  it("isAgentMode validates current strings only", () => {
    assert.ok(isAgentMode("live"));
    assert.ok(isAgentMode("delegated"));
    assert.ok(!isAgentMode("interactive"));
    assert.ok(!isAgentMode("autopilot"));
    assert.ok(!isAgentMode("auto"));
    assert.ok(!isAgentMode(""));
    assert.ok(!isAgentMode("LIVE"));
  });

  it("normalizeMode: passes through current names", () => {
    assert.equal(normalizeMode("live"), "live");
    assert.equal(normalizeMode("delegated"), "delegated");
  });

  it("normalizeMode: maps legacy names", () => {
    assert.equal(normalizeMode("interactive"), "live");
    assert.equal(normalizeMode("assisted"), "live");
    assert.equal(normalizeMode("autonomous"), "delegated");
    assert.equal(normalizeMode("autopilot"), "delegated");
  });

  it("normalizeMode: returns undefined on unknown input", () => {
    assert.equal(normalizeMode("randomstring"), undefined);
    assert.equal(normalizeMode(""), undefined);
    assert.equal(normalizeMode(undefined), undefined);
    assert.equal(normalizeMode(null), undefined);
  });
});
