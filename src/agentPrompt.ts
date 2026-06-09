/**
 * Per-feature agent system prompt — the standing behavioural convention each
 * banyan Claude agent runs with, on top of its own task. Encodes the mode
 * (autonomy level) the user picked at `bn wt` time.
 *
 * Two modes, mapping to the two banyan usage patterns:
 *
 *   live      — terminal-first, conversational. Claude is banyan-aware
 *                 (knows project/feature, sees banyan_* tools) but no
 *                 ceremony imposed. No mandatory report, no Stop hook
 *                 loop. The user is at the terminal driving.
 *
 *   delegated — dashboard-driven, gated pipeline. Claude submits a plan
 *                 for review, executes the approved TODO list, submits
 *                 a final report. Autopilot Stop hook keeps the agent
 *                 looping until banyan_report_done is called. The user
 *                 reviews artefacts (plan, report) via the dashboard
 *                 rather than watching live.
 *
 * Per-project overrides live at:
 *   ~/.config/banyan/<project>.agentprompt.<mode>.md
 *
 * Placeholders interpolated at launch time:
 *   {{project}}   project name
 *   {{feature}}   feature name
 *
 * Backwards compatibility: the legacy four modes (interactive / assisted /
 * autonomous / autopilot) are normalized at read time by `normalizeMode`:
 *   interactive | assisted  → live
 *   autonomous  | autopilot → delegated
 * So existing state files and YAML overrides keep working through this
 * refactor.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { isDraftFeature } from "./naming.js";

export type AgentMode = "live" | "delegated";

export const ALL_AGENT_MODES: readonly AgentMode[] = ["live", "delegated"] as const;

/** Legacy mode names that may appear in old state files or YAML overrides.
 *  Accepted on input, normalized to the current vocabulary. */
const LEGACY_MODES: Record<string, AgentMode> = {
  interactive: "live",
  assisted: "live",
  autonomous: "delegated",
  autopilot: "delegated",
};

const CONFIG_DIR = path.join(homedir(), ".config", "banyan");

const HEADER = `You are running as a per-feature agent inside a banyan workspace.
Your worktree is project '{{project}}', feature '{{feature}}'.

You have MCP tools available under the \`banyan_\` namespace.`;

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

const PLAN_REVIEW_BLOCK = `Before you start working, you MUST submit your plan for review:
  1. Set up a TODO list with banyan_set_todo describing the concrete steps you intend to take.
  2. Call banyan_request_plan_approval to signal you're ready for review.
  3. Wait. Don't start working on items until the supervisor releases you.
  4. If the user rejects, you'll receive their note via the supervisor — revise the TODO and call banyan_request_plan_approval again.`;

const DEFAULTS: Record<AgentMode, string> = {
  live: `${HEADER}

Mode: LIVE.

The user is at the terminal with you. This is a normal collaborative coding session — answer questions, make changes, ask clarifying things when the spec is genuinely unclear. Don't impose ceremony; act like the user is sitting next to you (because they are).

You have \`banyan_*\` MCP tools available. The most useful one in live mode is \`banyan_report_done\` — call it ONLY if the user explicitly asks for a summary or report of what was done. Don't volunteer it.

You don't need to call \`banyan_report_done\` to end the session. The session ends when the user closes the pane or runs cleanup.
`,

  delegated: `${HEADER}

Mode: DELEGATED.

The user is NOT watching this pane in real time. They handed you a task and will review your output via the banyan dashboard pipeline (plan → execute → report → optional test → optional validate → merge). Your job is to deliver a complete, reviewable artefact, not to chat.

Workflow (gated):

${PLAN_REVIEW_BLOCK}

Then EXECUTE. Work through every TODO item. Mark each done as you go:
  banyan_update_todo({ project: "{{project}}", feature: "{{feature}}", done: ["<id>"] })

Decide everything yourself — the user is not available to ask. Document hesitations in the final report instead of waiting.

If you discover a step is wrong or missing, edit the list (banyan_set_todo / banyan_update_todo). The user may also edit it from the dashboard — re-read with banyan_get_todo if you've been idle.

If you genuinely cannot decide (truly ambiguous spec, contradiction in requirements), submit a report with status="needs_review" + the question in openQuestions instead of stalling.

DO NOT stop the session until BOTH:
  1. every TODO item is marked done
  2. you have called \`banyan_report_done\`
A Stop hook will detect early stops and re-prompt you to continue.

${REPORT_BLOCK}

Be honest. The hesitations field is the most valuable signal you can leave the human reviewer.
`,
};

/** Normalize legacy mode names (interactive/assisted/autonomous/autopilot)
 *  to the current vocabulary (live/delegated). Returns undefined when the
 *  input doesn't match any known mode — callers should treat that as a
 *  validation error rather than picking a default silently. */
export function normalizeMode(s: string | undefined | null): AgentMode | undefined {
  if (!s) return undefined;
  if ((ALL_AGENT_MODES as readonly string[]).includes(s)) return s as AgentMode;
  return LEGACY_MODES[s];
}

export function projectPromptPath(projectName: string, mode: AgentMode): string {
  return path.join(CONFIG_DIR, `${projectName}.agentprompt.${mode}.md`);
}

/** Resolve the prompt template for a project + mode. Falls back from a
 *  per-project override file to the baked-in default. Legacy per-project
 *  override files (e.g. `<project>.agentprompt.autonomous.md`) are still
 *  read transparently as their new-mode equivalent. */
export function loadAgentPromptTemplate(projectName: string, mode: AgentMode): string {
  // Primary: the new-name file.
  const primary = projectPromptPath(projectName, mode);
  if (existsSync(primary)) {
    try {
      const txt = readFileSync(primary, "utf8");
      if (txt.trim().length > 0) return txt;
    } catch {
      /* fall through */
    }
  }

  // Legacy fallback: look for an old-name override file that maps to this
  // new mode. Lets users keep their customizations across the migration.
  const legacyAliases = Object.entries(LEGACY_MODES)
    .filter(([, target]) => target === mode)
    .map(([alias]) => alias);
  for (const alias of legacyAliases) {
    const legacy = path.join(CONFIG_DIR, `${projectName}.agentprompt.${alias}.md`);
    if (existsSync(legacy)) {
      try {
        const txt = readFileSync(legacy, "utf8");
        if (txt.trim().length > 0) return txt;
      } catch {
        /* try next */
      }
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

const DRAFT_BLOCK = `=== CRITICAL: DRAFT WORKTREE ===
This worktree was created without a feature name. Banyan generated the placeholder slug '{{feature}}' for you.

EVERY banyan_* tool except \`banyan_finalize_feature_name\` is BLOCKED until you finalize. You will see an error message telling you to finalize if you forget.

YOUR FIRST ACTION after the user's first instruction:
  1. Read the user's request carefully.
  2. Pick a short kebab-case slug that describes the task (e.g. "login-flow", "crash-on-close", "export-pdf-tweaks"). Lowercase. Hyphens between words. ≤30 chars. Avoid "fix" / "update" / "stuff".
  3. Call: banyan_finalize_feature_name({ name: "<your-slug>" })
  4. Banyan will rename the git branch + tmux pane to your slug. The on-disk path keeps its draft slug (cosmetic only — ignore it).
  5. Then proceed with the task normally.

If the user's request is too vague to name (e.g. they just said "hello"), ask them for one short phrase summarising what they want before you finalize. Do NOT invent a generic name to bypass this — wait for clarity.
===`;

/** Build the rendered system prompt for a feature. Always returns a non-empty
 *  string now (both modes inject a HEADER at minimum). Drafts get the
 *  finalize-name block prepended. */
export function buildAgentPrompt(
  projectName: string,
  feature: string,
  mode: AgentMode,
): string {
  const template = loadAgentPromptTemplate(projectName, mode);
  const base = renderAgentPrompt(template, { project: projectName, feature });
  if (isDraftFeature(feature)) {
    return renderAgentPrompt(DRAFT_BLOCK, { project: projectName, feature }) + "\n\n" + base;
  }
  return base;
}

/** Initialize the per-project per-mode prompt file from the default if it
 *  doesn't exist yet. Returns the path. */
export function ensureProjectPromptFile(projectName: string, mode: AgentMode): string {
  const p = projectPromptPath(projectName, mode);
  if (!existsSync(p)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(p, DEFAULTS[mode], "utf8");
  }
  return p;
}

/** Decide the agent mode when the caller didn't specify one.
 *  - explicit (normalized) wins
 *  - else: `delegated` when an initial prompt is being delegated (= fire-and-forget),
 *    `live` when the user is spawning to sit and chat (no prompt yet) */
export function resolveMode(
  explicit: AgentMode | string | undefined,
  hasInitialPrompt: boolean,
): AgentMode {
  const normalized = typeof explicit === "string" ? normalizeMode(explicit) : explicit;
  if (normalized) return normalized;
  return hasInitialPrompt ? "delegated" : "live";
}

export function isAgentMode(s: string): s is AgentMode {
  return (ALL_AGENT_MODES as readonly string[]).includes(s);
}
