/**
 * LLM-driven slug generation from a user prompt.
 *
 * Replaces banyan's old "draft worktree → agent finalizes name" flow with
 * dmux's cleaner approach: compute the slug from the prompt BEFORE creating
 * any worktree / docker stack / tmux pane. Everything is named correctly
 * from the start — no rename, no docker volume migration, no transcript
 * directory dance.
 *
 * Lookup chain (first available wins):
 *   1. OPENROUTER_API_KEY env → POST openrouter chat completions, trying
 *      Gemini Flash → Grok-Fast → GPT-4o-mini (fastest + cheapest)
 *   2. `claude --print` subprocess → reuses Claude Code auth, no extra setup
 *      but slower (~3-5s)
 *   3. Fallback: `<timestamp>` slug (caller can prefix with "draft-" if they
 *      want to signal "no slug could be inferred")
 *
 * Returns a sanitized kebab-case slug, lowercase, [a-z0-9-] only, never empty.
 */
import { spawn } from "node:child_process";

const OPENROUTER_MODELS = [
  "google/gemini-2.5-flash",
  "x-ai/grok-4-fast:free",
  "openai/gpt-4o-mini",
];

const SYSTEM_PROMPT =
  "Generate a 1-3 word kebab-case slug summarising the task in the user's prompt. " +
  "Lowercase, hyphens between words, [a-z0-9-] only, max 30 chars. " +
  "No prefixes like 'fix-' or 'add-' unless the prompt is genuinely about a fix or addition. " +
  "Reply with ONLY the slug, no quotes, no explanation, no markdown.";

/** Strip everything but a-z 0-9 -, collapse repeats, trim. Cap at 40 chars. */
function sanitize(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .trim()
    // Strip surrounding quotes / backticks the LLM sometimes adds.
    .replace(/^["'`]+|["'`]+$/g, "")
    // Replace non-alphanumeric with -
    .replace(/[^a-z0-9-]+/g, "-")
    // Collapse runs of -
    .replace(/-+/g, "-")
    // Trim leading/trailing -
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40);
}

/** OpenRouter chat-completions call. Returns null on any failure. */
async function viaOpenRouter(prompt: string, signal: AbortSignal): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  for (const model of OPENROUTER_MODELS) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          max_tokens: 16,
          temperature: 0.2,
        }),
        signal,
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content;
      if (raw) {
        const slug = sanitize(raw);
        if (slug) return slug;
      }
    } catch {
      // network / auth / timeout — try next model
    }
  }
  return null;
}

/** Fallback via local `claude --print`. Slower but works without OPENROUTER_API_KEY. */
function viaClaudePrint(prompt: string, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["--print"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    const onAbort = () => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      resolve(null);
    };
    signal.addEventListener("abort", onAbort);
    child.stdout.on("data", (b: Buffer) => { stdout += b.toString(); });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (code !== 0) { resolve(null); return; }
      const slug = sanitize(stdout);
      resolve(slug || null);
    });
    child.stdin.end(`${SYSTEM_PROMPT}\n\nPrompt: ${prompt}\n`);
  });
}

export interface GenerateSlugOpts {
  /** Hard cap on time spent across all backends. Default 12s — `claude --print`
   *  cold-start often takes 4-6s, so we leave headroom. Lower this if you
   *  set OPENROUTER_API_KEY (which typically responds in <1s). */
  timeoutMs?: number;
}

/**
 * Generate a slug from a free-form prompt. Always returns a non-empty
 * sanitised slug; on full failure falls back to a timestamp-based draft slug.
 */
export async function generateSlug(
  prompt: string,
  opts: GenerateSlugOpts = {},
): Promise<string> {
  if (!prompt || !prompt.trim()) return draftSlug();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
  try {
    const fromOR = await viaOpenRouter(prompt, controller.signal);
    if (fromOR) return fromOR;
    const fromCC = await viaClaudePrint(prompt, controller.signal);
    if (fromCC) return fromCC;
  } finally {
    clearTimeout(timer);
  }
  return draftSlug();
}

function draftSlug(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `draft-${ts}${rnd}`;
}
