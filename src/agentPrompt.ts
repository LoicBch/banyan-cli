/**
 * Per-feature agent system prompt — the standing behavioural convention each
 * banyan Claude agent runs with, on top of its own task. Encodes the mode
 * (autonomy level) the user picked at `bn wt` time.
 *
 * Modes:
 *   interactive — plain claude, no convention injected at all. You drive.
 *   assisted    — agent decides minor things, asks on big decisions.
 *   autonomous  — agent decides everything, documents uncertainties in the
 *                 final report's `hesitations`. Doesn't pause to ask.
 *   autopilot   — like autonomous + works through a TODO list, doesn't
 *                 stop until every item is done AND `banyan_report_done`
 *                 has been called. The Stop hook (commit 3) enforces this.
 *
 * Per-project overrides live at:
 *   ~/.config/banyan/<project>.agentprompt.<mode>.md
 *
 * Placeholders interpolated at launch time:
 *   {{project}}   project name
 *   {{feature}}   feature name
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type AgentMode = "interactive" | "assisted" | "autonomous" | "autopilot";

export const ALL_AGENT_MODES: readonly AgentMode[] = [
  "interactive",
  "assisted",
  "autonomous",
  "autopilot",
] as const;

const CONFIG_DIR = path.join(homedir(), ".config", "banyan");

const REPORT_BLOCK = `When you believe the task is complete, blocked, or needs human review, call \`banyan_report_done\` with:
  project: "{{project}}"
  feature: "{{feature}}"
  status:  "done" | "blocked" | "needs_review"
  summary: 1-3 sentences in plain language — the headline a human will scan first
  testInstructions: concrete steps a human can follow to verify the change before merging

Optional but valued:
  hesitations:   decisions you were uncertain about (the most valuable optional field — never omit a real hesitation to look confident)
  openQuestions: things you deliberately deferred or want answered before the work is fully done
  risks:         potential side effects, fragile zones, things to watch in production
  filesChanged:  files you touched (relative paths)
  commits:       [{ sha, message }] for commits you produced

Submit ONE final report when you think the task is complete. Don't submit progress reports during the work itself.`;

const HEADER = `You are running as a per-feature agent inside a banyan workspace.
Your worktree is project '{{project}}', feature '{{feature}}'.

You have MCP tools available under the \`banyan_\` namespace.`;

const DEFAULTS: Record<AgentMode, string> = {
  // No system prompt — banyan injects nothing, plain claude. The user drives.
  interactive: "",

  assisted: `${HEADER}

Mode: ASSISTED.

Decide minor implementation details on your own (variable names, small refactors, file organisation, mechanical edits).

Ask the user before:
  - architectural choices that change the shape of multiple files
  - breaking changes (API, public types, migrations)
  - decisions you can't undo cheaply

When in doubt about user-facing behaviour, ask. The user is available.

${REPORT_BLOCK}

Be honest about hesitations. A report that names them is more useful than one that pretends certainty.
`,

  autonomous: `${HEADER}

Mode: AUTONOMOUS.

Decide everything yourself. Do not pause to ask the user — they are not actively watching this pane. If you have a real concern, document it in the final report's \`hesitations\` field.

If you hit something you genuinely cannot decide (truly ambiguous spec, contradiction in the requirements), submit a report with status="needs_review" instead of waiting.

Don't stop the session until you've called \`banyan_report_done\`.

${REPORT_BLOCK}

Be honest. The user trusts you to make calls; the price of that trust is honest hesitations in the report.
`,

  autopilot: `${HEADER}

Mode: AUTOPILOT.

You have a TODO list managed by banyan. Read it now with:
  banyan_get_todo({ project: "{{project}}", feature: "{{feature}}" })

If no list exists yet, create one that breaks down your task into concrete steps:
  banyan_set_todo({ project: "{{project}}", feature: "{{feature}}", items: [...] })

Then work through every item. After completing each, mark it done:
  banyan_update_todo({ project: "{{project}}", feature: "{{feature}}", done: ["<id>"] })

If you discover a step is wrong or missing, edit the list (add/remove). The user can also edit it from outside — re-read with banyan_get_todo if you've been idle.

Decide everything yourself; the user is not actively watching. Document hesitations in the final report. If you genuinely can't decide between two paths, submit status="needs_review".

DO NOT stop the session until BOTH:
  1. every TODO item is marked done
  2. you have called \`banyan_report_done\`

A Stop hook will detect early stops and re-prompt you to continue.

${REPORT_BLOCK}

Be honest. The hesitations field is the most valuable signal you can leave the human reviewer.
`,
};

export function projectPromptPath(projectName: string, mode: AgentMode): string {
  return path.join(CONFIG_DIR, `${projectName}.agentprompt.${mode}.md`);
}

/** Resolve the prompt template for a project + mode. Returns:
 *   - the per-project per-mode file contents if it exists and is non-empty
 *   - otherwise the baked-in default for that mode
 *   - empty string for interactive (sentinel: no prompt to inject) */
export function loadAgentPromptTemplate(
  projectName: string,
  mode: AgentMode,
): string {
  const p = projectPromptPath(projectName, mode);
  if (existsSync(p)) {
    try {
      const txt = readFileSync(p, "utf8");
      if (txt.trim().length > 0) return txt;
    } catch {
      // fall through to default
    }
  }
  return DEFAULTS[mode];
}

export function getDefaultAgentPrompt(mode: AgentMode): string {
  return DEFAULTS[mode];
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

/** Build the rendered system prompt for a feature.
 *  Returns `undefined` for interactive mode (no system prompt to inject). */
export function buildAgentPrompt(
  projectName: string,
  feature: string,
  mode: AgentMode,
): string | undefined {
  const template = loadAgentPromptTemplate(projectName, mode);
  if (!template || template.trim().length === 0) return undefined;
  return renderAgentPrompt(template, { project: projectName, feature });
}

/** Initialize the per-project per-mode prompt file from the default if it
 *  doesn't exist yet. Returns the path. */
export function ensureProjectPromptFile(
  projectName: string,
  mode: AgentMode,
): string {
  const p = projectPromptPath(projectName, mode);
  if (!existsSync(p)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(p, DEFAULTS[mode], "utf8");
  }
  return p;
}

/** Decide the agent mode based on caller intent. Used by `bn wt` and
 *  `banyan_create_feature` to compute a sensible default when the caller
 *  didn't specify a mode explicitly.
 *
 *  - explicit mode wins
 *  - else: `autonomous` if a prompt is being delegated, `interactive` if
 *    not (sitting next to the agent, plain claude)
 */
export function resolveMode(
  explicit: AgentMode | undefined,
  hasInitialPrompt: boolean,
): AgentMode {
  if (explicit) return explicit;
  return hasInitialPrompt ? "autonomous" : "interactive";
}

export function isAgentMode(s: string): s is AgentMode {
  return (ALL_AGENT_MODES as readonly string[]).includes(s);
}
