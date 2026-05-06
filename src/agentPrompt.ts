/**
 * Per-feature agent system prompt — the standing convention every banyan
 * Claude agent runs with, on top of its own task.
 *
 * Lookup order:
 *   1. ~/.config/banyan/<project>.agentprompt.md  (per-project override)
 *   2. baked-in DEFAULT below
 *
 * The text is passed to `claude --append-system-prompt`, so it stays out
 * of the user-visible chat history and applies on every turn (resumed or
 * fresh sessions both).
 *
 * Placeholders interpolated at launch time:
 *   {{project}}   project name
 *   {{feature}}   feature name
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(homedir(), ".config", "banyan");

export const DEFAULT_AGENT_PROMPT = `You are running as a per-feature agent inside a banyan workspace.
Your worktree is project '{{project}}', feature '{{feature}}'.

You have MCP tools available under the \`banyan_\` namespace.

When you believe you have completed, blocked on, or want a human review of the assigned task, call \`banyan_report_done\` with:

  project: "{{project}}"
  feature: "{{feature}}"
  status:  "done" | "blocked" | "needs_review"
  summary: 1-3 sentences in plain language — the headline a human will scan first
  testInstructions: concrete steps a human can follow to verify the change before merging

Optional but valued:
  hesitations:   decisions you were uncertain about (the most important optional field — never omit a real hesitation to look confident)
  openQuestions: things you deliberately deferred or want answered before the work is fully done
  risks:         potential side effects, fragile zones, things to watch in production
  filesChanged:  files you touched (relative paths)
  commits:       [{ sha, message }] for commits you produced

Submit ONE final report when you think the task is complete. If you discover something that requires a follow-up, you may submit another report (history is preserved) — but don't submit progress reports during the work itself; the conversation log is sufficient for that.

Be honest. A report that names hesitations is more useful than one that pretends certainty.
`;

export function projectPromptPath(projectName: string): string {
  return path.join(CONFIG_DIR, `${projectName}.agentprompt.md`);
}

/** Resolve the prompt template for a project. Returns the per-project file
 *  contents if it exists, otherwise the baked-in default. */
export function loadAgentPromptTemplate(projectName: string): string {
  const p = projectPromptPath(projectName);
  if (existsSync(p)) {
    try {
      const txt = readFileSync(p, "utf8");
      if (txt.trim().length > 0) return txt;
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_AGENT_PROMPT;
}

/** Substitute {{project}} / {{feature}} placeholders in a template. */
export function renderAgentPrompt(
  template: string,
  vars: { project: string; feature: string },
): string {
  return template
    .replaceAll("{{project}}", vars.project)
    .replaceAll("{{feature}}", vars.feature);
}

/** Convenience: load + render in one go. */
export function buildAgentPrompt(projectName: string, feature: string): string {
  return renderAgentPrompt(loadAgentPromptTemplate(projectName), {
    project: projectName,
    feature,
  });
}

/** Initialize the per-project prompt file from the default template if it
 *  doesn't exist yet. Returns the path. Used by `bn <project> agent-prompt
 *  --edit` so the user has something concrete to edit. */
export function ensureProjectPromptFile(projectName: string): string {
  const p = projectPromptPath(projectName);
  if (!existsSync(p)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(p, DEFAULT_AGENT_PROMPT, "utf8");
  }
  return p;
}
