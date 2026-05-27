/**
 * Context assembly for `bn ask` — gather signals from across the project that
 * a Claude one-shot can use to answer questions about past work.
 *
 * Three signal sources, each capped at a byte budget so the total prompt stays
 * manageable:
 *   1. Reports — every end-of-task report submitted in this project. Tiny,
 *      structured, the most useful piece of context per byte.
 *   2. Commits — `git log` from each git repo of the project, last N days,
 *      with subject + short body so the agent sees what shipped.
 *   3. Transcripts — agent conversation history under
 *      `~/.claude/projects/<encoded-cwd>/*.jsonl`. Huge raw, so we keyword-
 *      filter against the question and only include excerpts around matches.
 *
 * Each block is prefixed with a clear heading so the agent knows the source.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { runOrThrow } from "../exec.js";
import { readReports, type FeatureReport } from "../reports.js";
import { readHistoryEvents } from "../history.js";
import type { ProjectConfig } from "../config.js";

export interface BuildContextOpts {
  /** Restrict to a single feature's reports + transcripts. */
  feature?: string;
  /** Days of `git log` to include per repo. Default: 30. */
  daysOfCommits?: number;
  /** Include transcripts. Default: true. Set false to skip the heavy scan. */
  includeTranscripts?: boolean;
  /** Hard byte cap for transcripts (best-effort). Default: 80_000. */
  transcriptByteBudget?: number;
}

/**
 * Build the full system context string. Returned text is meant to be piped
 * to `claude --print` as the system / context portion; the user's question
 * is sent separately.
 */
export async function buildContext(
  project: ProjectConfig,
  question: string,
  opts: BuildContextOpts = {},
): Promise<string> {
  const sections: string[] = [];
  sections.push(`# Project: ${project.name}`);
  if (opts.feature) sections.push(`# Scope: feature \`${opts.feature}\` only`);

  sections.push(formatReportsBlock(project.name, opts.feature));
  sections.push(formatMergeHistoryBlock(project.name, opts.feature));
  sections.push(await formatCommitsBlock(project, opts));
  if (opts.includeTranscripts !== false) {
    sections.push(formatTranscriptsBlock(project, question, opts));
  }
  return sections.join("\n\n");
}

// ── merge history (from history.jsonl, captured at merge time) ─────────
function formatMergeHistoryBlock(projectName: string, feature?: string): string {
  const events = readHistoryEvents(projectName, {
    kind: "merge",
    ...(feature ? { feature } : {}),
    limit: 100,
  });
  if (events.length === 0) {
    return "## Merge history\n(no merge events recorded yet)";
  }
  const lines = ["## Merge history", `${events.length} merge(s), newest first:`];
  for (const ev of events) {
    if (ev.kind !== "merge") continue;
    const date = ev.ts.slice(0, 10);
    const id = ev.mrNumber !== undefined ? `MR #${ev.mrNumber}` : (ev.local ? "local merge" : "merge");
    const author = ev.mrAuthor ? ` by @${ev.mrAuthor}` : "";
    const stats = (ev.filesChanged !== undefined || ev.additions !== undefined)
      ? ` [${ev.filesChanged ?? "?"} files, +${ev.additions ?? 0}/-${ev.deletions ?? 0}]`
      : "";
    const title = ev.mrTitle ? ` — ${ev.mrTitle}` : "";
    lines.push("");
    lines.push(`- ${date} ${ev.repo}/${ev.feature} ${id}${author}${stats}${title}`);
    if (ev.mrBody) {
      const body = ev.mrBody.length > 400 ? ev.mrBody.slice(0, 400) + "…" : ev.mrBody;
      lines.push(`  body: ${body.replace(/\n/g, "\n  ")}`);
    }
  }
  return lines.join("\n");
}

// ── reports ─────────────────────────────────────────────────────────────
function formatReportsBlock(projectName: string, feature?: string): string {
  const reports = readReports(projectName, {
    feature: feature ?? undefined,
  }) as FeatureReport[];
  if (reports.length === 0) {
    return "## Reports\n(no reports submitted yet for this project)";
  }
  const lines = ["## Reports", `${reports.length} report(s), oldest first:`];
  for (const r of reports) {
    lines.push("");
    lines.push(`### ${r.ts} — ${r.feature} (${r.status})`);
    lines.push(`Summary: ${r.summary}`);
    if (r.hesitations?.length) lines.push(`Hesitations: ${r.hesitations.join(" / ")}`);
    if (r.openQuestions?.length) lines.push(`Open questions: ${r.openQuestions.join(" / ")}`);
    if (r.risks?.length) lines.push(`Risks: ${r.risks.join(" / ")}`);
    if (r.commits?.length) {
      lines.push(`Commits: ${r.commits.map((c) => `${c.sha.slice(0, 7)} ${c.message}`).join("; ")}`);
    }
    if (r.filesChanged?.length) {
      lines.push(`Files: ${r.filesChanged.slice(0, 15).join(", ")}${r.filesChanged.length > 15 ? "…" : ""}`);
    }
  }
  return lines.join("\n");
}

// ── commits ─────────────────────────────────────────────────────────────
async function formatCommitsBlock(
  project: ProjectConfig,
  opts: BuildContextOpts,
): Promise<string> {
  const days = opts.daysOfCommits ?? 30;
  const since = `--since=${days}.days.ago`;
  const lines = [`## Recent commits (last ${days} days, all git repos)`];
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    if (!existsSync(repo.path)) continue;
    try {
      const out = await runOrThrow(
        "git",
        ["log", since, "--all", "--pretty=format:%h|%an|%ad|%s", "--date=short", "-200"],
        { cwd: repo.path },
      );
      if (!out.trim()) continue;
      lines.push("");
      lines.push(`### ${repo.name}`);
      // Reasonable cap per repo so a busy monorepo doesn't drown the others.
      const rows = out.trim().split("\n").slice(0, 100);
      for (const row of rows) {
        const [sha, author, date, ...subjParts] = row.split("|");
        lines.push(`- ${date} ${sha} (${author}) ${subjParts.join("|")}`);
      }
    } catch {
      // skip repos that aren't a git repo right now
    }
  }
  return lines.join("\n");
}

// ── transcripts ─────────────────────────────────────────────────────────
function formatTranscriptsBlock(
  project: ProjectConfig,
  question: string,
  opts: BuildContextOpts,
): string {
  const budget = opts.transcriptByteBudget ?? 80_000;
  const keywords = extractKeywords(question);
  if (keywords.length === 0) {
    return "## Transcripts\n(no keywords extracted from the question — skipping transcript search)";
  }

  // Encoded cwd: claude code stores transcripts under ~/.claude/projects/
  // with each project key = absolute cwd with '/' → '-'. Build the candidate
  // dirs from each git repo path + every existing worktree under it.
  const candidates = collectClaudeProjectDirs(project);
  if (candidates.length === 0) {
    return "## Transcripts\n(no transcript dirs found for this project's repos)";
  }

  const excerpts: Array<{ file: string; snippet: string; score: number }> = [];
  for (const dir of candidates) {
    for (const file of listTranscriptFiles(dir)) {
      const found = scanTranscript(file, keywords, opts.feature);
      if (found.length > 0) {
        for (const e of found) excerpts.push(e);
      }
    }
  }
  if (excerpts.length === 0) {
    return `## Transcripts\nKeywords searched: ${keywords.join(", ")}\n(no matches in transcripts)`;
  }

  // Most-relevant first, then trim to budget.
  excerpts.sort((a, b) => b.score - a.score);
  const lines = ["## Transcripts", `Keywords: ${keywords.join(", ")}`, ""];
  let used = 0;
  for (const e of excerpts) {
    const block = `### From ${path.basename(e.file)}\n${e.snippet}\n`;
    if (used + block.length > budget) break;
    lines.push(block);
    used += block.length;
  }
  return lines.join("\n");
}

function extractKeywords(question: string): string[] {
  // Drop tiny words and common stop-words, lowercase, dedup. Crude but cheap.
  const stop = new Set([
    "the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "of", "to",
    "for", "with", "and", "or", "but", "we", "i", "you", "he", "she", "it",
    "what", "why", "how", "when", "where", "who", "did", "do", "does", "this",
    "that", "those", "these", "be", "been", "being", "been",
    // french stopwords (questions can be in either)
    "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "où",
    "qui", "que", "quoi", "comment", "pourquoi", "quand", "est", "ce", "ça",
    "sur", "dans", "pour", "avec",
  ]);
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9_\-]+/)
        .filter((w) => w.length >= 3 && !stop.has(w)),
    ),
  );
}

function encodeCwd(absPath: string): string {
  return absPath.replace(/\//g, "-");
}

function collectClaudeProjectDirs(project: ProjectConfig): string[] {
  const root = path.join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    if (!existsSync(repo.path)) continue;
    const encoded = encodeCwd(repo.path);
    const dir = path.join(root, encoded);
    if (existsSync(dir)) out.push(dir);

    // Also the worktree-<name> sibling dir, which is what banyan creates
    // (every feature pane runs claude with cwd = a worktree).
    const wtRoot = path.join(path.dirname(repo.path), `worktree-${path.basename(repo.path)}`);
    if (existsSync(wtRoot)) {
      for (const entry of readdirSync(wtRoot)) {
        const wt = path.join(wtRoot, entry);
        try {
          if (!statSync(wt).isDirectory()) continue;
        } catch {
          continue;
        }
        const wtEnc = encodeCwd(wt);
        const wtDir = path.join(root, wtEnc);
        if (existsSync(wtDir)) out.push(wtDir);
      }
    }
  }
  return out;
}

function listTranscriptFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Scan one transcript file for keyword hits. Returns up to a few excerpts
 * per file: a snippet of the matching user/assistant text. Score = number
 * of distinct keywords matched in the excerpt.
 */
function scanTranscript(
  file: string,
  keywords: string[],
  filterFeature: string | undefined,
): Array<{ file: string; snippet: string; score: number }> {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  // If filtering by feature, require that feature to appear somewhere in
  // the file. This is a heuristic — transcripts may not name the feature.
  if (filterFeature && !content.toLowerCase().includes(filterFeature.toLowerCase())) {
    return [];
  }
  const out: Array<{ file: string; snippet: string; score: number }> = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length < 10) continue;
    // Extract human-readable text from JSONL events when possible.
    let text = "";
    try {
      const ev = JSON.parse(line);
      if (ev.type === "user" || ev.type === "assistant") {
        const content = ev.message?.content;
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          text = content
            .map((c: any) => (typeof c.text === "string" ? c.text : ""))
            .join(" ");
        }
      }
    } catch {
      continue;
    }
    if (!text) continue;
    const lower = text.toLowerCase();
    let score = 0;
    for (const k of keywords) if (lower.includes(k)) score++;
    if (score === 0) continue;
    // Trim long lines.
    const snippet = text.length > 800 ? text.slice(0, 800) + "…" : text;
    out.push({ file, snippet, score });
    if (out.length >= 3) break; // cap per file
  }
  return out;
}
