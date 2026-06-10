/**
 * Transcript search for the orchestrator. Greps the project's claude
 * conversation transcripts (under ~/.claude/projects/<encoded-cwd>/*.jsonl)
 * for keywords and returns matching excerpts.
 *
 * Ported from the previous `src/ask/context.ts` transcript scanner. The
 * orchestrator uses this via `banyan_search_transcripts` to dig into what
 * sub-agents have said when answering questions about past work — the
 * use case `bn ask` used to cover before it was dropped.
 *
 * Crude on purpose: keyword match (not vector search), excerpt around hits
 * (not full conversations), per-file cap (not exhaustive). Cheap and good
 * enough for "what did the auth feature's agent say about CORS?".
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getProject } from "../../config.js";
import { getConfig } from "./shared.js";

export interface TranscriptHit {
  /** Basename of the .jsonl transcript file. */
  file: string;
  /** Excerpt around the keyword match (capped at 800 chars). */
  snippet: string;
  /** Count of distinct keywords matched in this excerpt. Higher = more
   *  relevant. Caller can sort on this. */
  score: number;
}

export async function searchTranscripts(
  projectName: string,
  query: string,
  opts: {
    /** Optional feature name — only scan transcripts that mention it. */
    feature?: string;
    /** Max number of hits to return across all files. Default: 20. */
    limit?: number;
  } = {},
): Promise<{ hits: TranscriptHit[]; keywords: string[]; filesScanned: number }> {
  const config = await getConfig();
  const project = getProject(config, projectName);
  const keywords = extractKeywords(query);
  if (keywords.length === 0) {
    return { hits: [], keywords: [], filesScanned: 0 };
  }

  const dirs = collectClaudeProjectDirs(project);
  const allHits: TranscriptHit[] = [];
  let filesScanned = 0;
  for (const dir of dirs) {
    for (const file of listTranscriptFiles(dir)) {
      filesScanned++;
      const hits = scanTranscript(file, keywords, opts.feature);
      allHits.push(...hits);
    }
  }
  allHits.sort((a, b) => b.score - a.score);
  return {
    hits: allHits.slice(0, opts.limit ?? 20),
    keywords,
    filesScanned,
  };
}

function extractKeywords(question: string): string[] {
  // Drop tiny words and common stop-words (EN + FR), lowercase, dedup.
  // Same heuristic the old `bn ask` engine used.
  const stop = new Set([
    "the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "of", "to",
    "for", "with", "and", "or", "but", "we", "i", "you", "he", "she", "it",
    "what", "why", "how", "when", "where", "who", "did", "do", "does", "this",
    "that", "those", "these", "be", "been", "being",
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

function collectClaudeProjectDirs(
  project: import("../../config.js").ProjectConfig,
): string[] {
  // Claude stores transcripts under ~/.claude/projects/<encoded-cwd>/.
  // Each project's transcripts include the main checkout cwd + every
  // worktree cwd that ever ran claude (= every feature pane).
  const root = path.join(homedir(), ".claude", "projects");
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const repo of project.repos) {
    if (repo.type === "compose") continue;
    if (!existsSync(repo.path)) continue;
    const main = path.join(root, encodeCwd(repo.path));
    if (existsSync(main)) out.push(main);
    // worktree-<basename>/<feature>/ siblings
    const wtRoot = path.join(
      path.dirname(repo.path),
      `worktree-${path.basename(repo.path)}`,
    );
    if (existsSync(wtRoot)) {
      for (const entry of readdirSync(wtRoot)) {
        const wt = path.join(wtRoot, entry);
        try {
          if (!statSync(wt).isDirectory()) continue;
        } catch {
          continue;
        }
        const wtDir = path.join(root, encodeCwd(wt));
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

function scanTranscript(
  file: string,
  keywords: string[],
  filterFeature: string | undefined,
): TranscriptHit[] {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  if (filterFeature && !content.toLowerCase().includes(filterFeature.toLowerCase())) {
    return [];
  }
  const out: TranscriptHit[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.length < 10) continue;
    let text = "";
    try {
      const ev = JSON.parse(line);
      if (ev.type === "user" || ev.type === "assistant") {
        const content = ev.message?.content;
        if (typeof content === "string") text = content;
        else if (Array.isArray(content)) {
          text = content
            .map((c: { text?: string }) => (typeof c.text === "string" ? c.text : ""))
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
    const snippet = text.length > 800 ? text.slice(0, 800) + "…" : text;
    out.push({ file: path.basename(file), snippet, score });
    if (out.length >= 3) break; // cap per file
  }
  return out;
}
