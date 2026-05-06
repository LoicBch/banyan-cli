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
} = mod;

const CONFIG_DIR = path.join(tmpHome!, ".config", "banyan");

describe("agentPrompt", () => {
  beforeEach(() => {
    if (existsSync(CONFIG_DIR)) {
      rmSync(CONFIG_DIR, { recursive: true, force: true });
    }
  });

  it("ALL_AGENT_MODES has the four expected modes", () => {
    assert.deepEqual([...ALL_AGENT_MODES], [
      "interactive",
      "assisted",
      "autonomous",
      "autopilot",
    ]);
  });

  it("interactive mode has an empty default (no prompt injected)", () => {
    assert.equal(getDefaultAgentPrompt("interactive"), "");
  });

  it("non-interactive modes have non-empty defaults", () => {
    for (const m of ["assisted", "autonomous", "autopilot"] as const) {
      assert.ok(getDefaultAgentPrompt(m).length > 0, `mode ${m} should have default`);
    }
  });

  it("loadAgentPromptTemplate returns the default when no file exists", () => {
    assert.equal(loadAgentPromptTemplate("demo", "autonomous"), getDefaultAgentPrompt("autonomous"));
  });

  it("loadAgentPromptTemplate returns the per-project per-mode file when present", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(projectPromptPath("demo", "autonomous"), "custom autonomous", "utf8");
    assert.equal(loadAgentPromptTemplate("demo", "autonomous"), "custom autonomous");
    // assisted still picks up its default
    assert.equal(loadAgentPromptTemplate("demo", "assisted"), getDefaultAgentPrompt("assisted"));
  });

  it("loadAgentPromptTemplate ignores empty per-project files", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(projectPromptPath("demo", "autonomous"), "   \n  \n", "utf8");
    assert.equal(loadAgentPromptTemplate("demo", "autonomous"), getDefaultAgentPrompt("autonomous"));
  });

  it("renderAgentPrompt substitutes placeholders", () => {
    const out = renderAgentPrompt("hello {{project}} / {{feature}}!", {
      project: "p4n",
      feature: "login",
    });
    assert.equal(out, "hello p4n / login!");
  });

  it("buildAgentPrompt returns undefined for interactive mode", () => {
    assert.equal(buildAgentPrompt("p4n", "login", "interactive"), undefined);
  });

  it("buildAgentPrompt renders + substitutes for non-interactive modes", () => {
    const out = buildAgentPrompt("p4n", "login", "autonomous");
    assert.ok(out, "should produce a prompt");
    assert.ok(out!.includes("'p4n'"));
    assert.ok(out!.includes("'login'"));
    assert.ok(!out!.includes("{{project}}"));
  });

  it("ensureProjectPromptFile creates the file from the default for the mode", () => {
    const p = ensureProjectPromptFile("demo", "assisted");
    assert.ok(existsSync(p));
    assert.equal(loadAgentPromptTemplate("demo", "assisted"), getDefaultAgentPrompt("assisted"));
  });

  it("ensureProjectPromptFile is idempotent (does not overwrite existing)", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(projectPromptPath("demo", "autopilot"), "user-edited", "utf8");
    ensureProjectPromptFile("demo", "autopilot");
    assert.equal(loadAgentPromptTemplate("demo", "autopilot"), "user-edited");
  });

  it("resolveMode: explicit mode wins", () => {
    assert.equal(resolveMode("autopilot", true), "autopilot");
    assert.equal(resolveMode("interactive", true), "interactive");
  });

  it("resolveMode: defaults to autonomous when prompt is given, interactive otherwise", () => {
    assert.equal(resolveMode(undefined, true), "autonomous");
    assert.equal(resolveMode(undefined, false), "interactive");
  });

  it("isAgentMode validates strings", () => {
    assert.ok(isAgentMode("interactive"));
    assert.ok(isAgentMode("assisted"));
    assert.ok(isAgentMode("autonomous"));
    assert.ok(isAgentMode("autopilot"));
    assert.ok(!isAgentMode("auto"));
    assert.ok(!isAgentMode(""));
    assert.ok(!isAgentMode("AUTONOMOUS"));
  });
});
