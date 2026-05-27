/**
 * `bn ask` engine — spawns `claude --print` with assembled project context
 * and the user's question, streams the response to the caller, and appends
 * the full Q&A to a persistent JSONL log per project.
 *
 * Why `claude --print` instead of the Anthropic SDK?
 *  - Reuses whatever auth the user already has set up for Claude Code
 *    (subscription or API key), no extra ANTHROPIC_API_KEY required.
 *  - Zero new dependencies.
 *  - Streaming via stdout is simple and works through SSE just as well.
 *  - We can swap to the SDK later if we need streaming token-by-token,
 *    function-calling, or finer model control.
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { buildContext, type BuildContextOpts } from "./context.js";
import { getProject, type Config } from "../config.js";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");

export interface AskOpts extends BuildContextOpts {
  /** Override the model passed to `claude --print --model <m>`. */
  model?: string;
}

export interface AskRecord {
  ts: string;
  project: string;
  question: string;
  scope: { feature?: string };
  answer: string;
  durationMs: number;
}

/**
 * Run an ask. `onChunk` is called for every stdout chunk from `claude
 * --print` as it streams — pipe it to stdout for the CLI or to SSE for the
 * dashboard. Returns the fully accumulated answer + persisted record.
 */
export async function ask(
  config: Config,
  projectName: string,
  question: string,
  opts: AskOpts = {},
  onChunk?: (text: string) => void,
): Promise<AskRecord> {
  const project = getProject(config, projectName);
  const context = await buildContext(project, question, opts);

  const prompt = buildPrompt(context, question);
  const start = Date.now();
  const answer = await spawnClaudePrint(prompt, opts.model, onChunk);
  const durationMs = Date.now() - start;

  const record: AskRecord = {
    ts: new Date().toISOString(),
    project: projectName,
    question,
    scope: opts.feature ? { feature: opts.feature } : {},
    answer,
    durationMs,
  };
  appendAskHistory(projectName, record);
  return record;
}

function buildPrompt(context: string, question: string): string {
  return [
    "You are answering a question about a software project's past work. ",
    "Below is structured context: end-of-task reports submitted by agents, ",
    "recent commits across the repos, and excerpts from agent conversation ",
    "transcripts filtered by the question's keywords.\n\n",
    "Ground every claim in the context. When you cite, reference the source ",
    "(report timestamp, commit SHA, transcript filename). If the context ",
    "doesn't contain enough to answer confidently, say so plainly and ",
    "suggest what additional info would help.\n\n",
    "=========== CONTEXT ===========\n",
    context,
    "\n========== END CONTEXT ==========\n\n",
    "=========== QUESTION ===========\n",
    question,
    "\n",
  ].join("");
}

function spawnClaudePrint(
  prompt: string,
  model: string | undefined,
  onChunk: ((text: string) => void) | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["--print"];
    if (model) args.push("--model", model);
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (onChunk) onChunk(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude --print exited ${code}: ${stderr.trim() || "(no stderr)"}`));
    });
    child.stdin.end(prompt);
  });
}

// ── persistence ────────────────────────────────────────────────────────
function historyPath(projectName: string): string {
  return path.join(STATE_DIR, `${projectName}.ask-history.jsonl`);
}

export function appendAskHistory(projectName: string, record: AskRecord): void {
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(historyPath(projectName), JSON.stringify(record) + "\n", "utf8");
}

export function readAskHistory(projectName: string, limit = 50): AskRecord[] {
  const p = historyPath(projectName);
  if (!existsSync(p)) return [];
  const raw = readFileSync(p, "utf8");
  const records: AskRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try { records.push(JSON.parse(line) as AskRecord); } catch { /* skip corrupt line */ }
  }
  // Newest first, capped.
  return records.reverse().slice(0, limit);
}
