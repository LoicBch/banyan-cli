/**
 * LLM-driven slug generation from a user prompt — OpenRouter only.
 *
 * Caller passes a free-form prompt ("implement OAuth login with Google
 * provider"), we POST to OpenRouter chat-completions and get back a
 * sanitized kebab-case slug ("oauth-login").
 *
 * Key resolution: env var `OPENROUTER_API_KEY` first (works for CI /
 * power users), then `~/.config/banyan/config.yaml` `llm.openrouterApiKey`
 * (configurable from the dashboard's Config tab). When neither is set,
 * `generateSlug` throws — the caller (CLI / dashboard wt route) catches
 * this and surfaces a friendly error telling the user to either pass an
 * explicit feature name or set their API key.
 *
 * We removed the previous `claude --print` fallback (~3-5s cold start,
 * burns a tour de l'abonnement claude for a 16-token task) in favour of
 * a clean single-provider design. OpenRouter is fast (~1s with Gemini
 * Flash) and lets the user pick any model — free (`:free` models) or
 * paid — from their own account.
 */
import { ConfigError, UsageError } from "./errors.js";
import { loadConfigSync } from "./config.js";

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

const MISSING_KEY_MESSAGE =
  "Feature naming from a prompt needs an OpenRouter API key. " +
  "Set it in the dashboard (Config tab → LLM) or edit ~/.config/banyan/config.yaml " +
  "under `llm.openrouterApiKey`. You can also pass it via the OPENROUTER_API_KEY env var. " +
  "Free OpenRouter models (e.g. x-ai/grok-4-fast:free) are zero-cost. " +
  "Workaround: pass an explicit feature name (e.g. `bn wt my-feature -p \"...\"`) and the LLM is skipped.";

/** Read the OpenRouter API key from env first, then from the loaded
 *  banyan config. Returns undefined when neither is set. */
function resolveApiKey(): string | undefined {
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const cfg = loadConfigSync();
  const fromCfg = cfg?.llm?.openrouterApiKey;
  if (fromCfg && fromCfg.length > 0) return fromCfg;
  return undefined;
}

/** Strip everything but a-z 0-9 -, collapse repeats, trim. Cap at 40 chars. */
function sanitize(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 40);
}

/** OpenRouter chat-completions call. Tries each model in order until one
 *  returns a non-empty sanitized slug. Throws on every-model failure so the
 *  caller can surface the underlying network/auth error. */
async function viaOpenRouter(
  prompt: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<string> {
  let lastError: unknown;
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
      if (!res.ok) {
        lastError = new Error(`${model}: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = data.choices?.[0]?.message?.content;
      if (raw) {
        const slug = sanitize(raw);
        if (slug) return slug;
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `All OpenRouter models failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export interface GenerateSlugOpts {
  /** Hard cap on time spent. Default 8s — Gemini Flash typically returns
   *  in <1s; the free models can be slower under load. */
  timeoutMs?: number;
}

/** Custom error thrown when no API key is configured. Callers should
 *  catch this and surface a friendly user-facing message rather than the
 *  raw stack. */
export class OpenRouterKeyMissingError extends UsageError {
  constructor() {
    super(MISSING_KEY_MESSAGE);
    this.name = "OpenRouterKeyMissingError";
  }
}

/**
 * Generate a slug from a free-form prompt via OpenRouter. Throws
 * `OpenRouterKeyMissingError` if no API key is configured anywhere.
 * Throws a generic `ConfigError` if OpenRouter is unreachable / all
 * models fail.
 */
export async function generateSlug(
  prompt: string,
  opts: GenerateSlugOpts = {},
): Promise<string> {
  if (!prompt || !prompt.trim()) {
    throw new UsageError("cannot generate a slug from an empty prompt");
  }
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new OpenRouterKeyMissingError();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000);
  try {
    return await viaOpenRouter(prompt, apiKey, controller.signal);
  } catch (err) {
    throw new ConfigError(
      `Slug generation failed via OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
