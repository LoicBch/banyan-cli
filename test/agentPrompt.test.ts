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
  DEFAULT_AGENT_PROMPT,
  loadAgentPromptTemplate,
  renderAgentPrompt,
  buildAgentPrompt,
  ensureProjectPromptFile,
  projectPromptPath,
} = mod;

const CONFIG_DIR = path.join(tmpHome!, ".config", "banyan");

describe("agentPrompt", () => {
  beforeEach(() => {
    if (existsSync(CONFIG_DIR)) {
      rmSync(CONFIG_DIR, { recursive: true, force: true });
    }
  });

  it("loadAgentPromptTemplate returns the default when no file exists", () => {
    assert.equal(loadAgentPromptTemplate("demo"), DEFAULT_AGENT_PROMPT);
  });

  it("loadAgentPromptTemplate returns the per-project file when present", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(projectPromptPath("demo"), "custom prompt for demo", "utf8");
    assert.equal(loadAgentPromptTemplate("demo"), "custom prompt for demo");
  });

  it("loadAgentPromptTemplate ignores empty per-project files", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(projectPromptPath("demo"), "   \n  \n", "utf8");
    assert.equal(loadAgentPromptTemplate("demo"), DEFAULT_AGENT_PROMPT);
  });

  it("renderAgentPrompt substitutes placeholders", () => {
    const out = renderAgentPrompt("hello {{project}} / {{feature}}!", {
      project: "p4n",
      feature: "login",
    });
    assert.equal(out, "hello p4n / login!");
  });

  it("renderAgentPrompt substitutes every occurrence", () => {
    const out = renderAgentPrompt("{{project}} {{project}} {{feature}}", {
      project: "x",
      feature: "y",
    });
    assert.equal(out, "x x y");
  });

  it("buildAgentPrompt loads + renders in one go", () => {
    const out = buildAgentPrompt("p4n", "login");
    assert.ok(out.includes("'p4n'"), "should include project name");
    assert.ok(out.includes("'login'"), "should include feature name");
    assert.ok(!out.includes("{{project}}"), "no placeholders left");
    assert.ok(!out.includes("{{feature}}"), "no placeholders left");
  });

  it("ensureProjectPromptFile creates the file from the default", () => {
    const p = ensureProjectPromptFile("demo");
    assert.ok(existsSync(p));
    assert.equal(loadAgentPromptTemplate("demo"), DEFAULT_AGENT_PROMPT);
  });

  it("ensureProjectPromptFile is idempotent (does not overwrite existing)", () => {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(projectPromptPath("demo"), "user-edited", "utf8");
    ensureProjectPromptFile("demo");
    assert.equal(loadAgentPromptTemplate("demo"), "user-edited");
  });
});
