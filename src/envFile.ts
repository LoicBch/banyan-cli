/**
 * Minimal `.env` file parser. Used by `loadEnvFiles` to inject variables into
 * the run command's environment.
 *
 * Supported syntax (covers ~99% of real-world .env files):
 *   - `KEY=value`             literal value, trimmed of surrounding whitespace
 *   - `KEY="value"`           double-quoted (whitespace + `#` preserved)
 *   - `KEY='value'`           single-quoted
 *   - `export KEY=value`      `export` prefix is tolerated and stripped
 *   - `# comment`             whole-line comment
 *   - blank lines
 *
 * NOT supported (silently ignored to keep behavior predictable):
 *   - Variable interpolation: `KEY=${OTHER}`
 *   - Multi-line values
 *   - Backslash escapes inside quoted values
 *   - Inline comments after a non-quoted value (`KEY=val # cmt` — the whole
 *     `val # cmt` becomes the value, matching dotenv's behavior)
 *
 * Lines that don't fit the `KEY=value` shape are skipped with a warning so a
 * mis-edited file doesn't kill the run command.
 */
import { existsSync, readFileSync } from "node:fs";

export interface ParseEnvOptions {
  /** Called with a human-readable warning for each skipped line. */
  onWarn?: (msg: string) => void;
}

const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseEnvText(
  text: string,
  opts: ParseEnvOptions = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Drop optional `export ` prefix — common in .env files meant for `source`.
    const stripped = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trimStart()
      : trimmed;

    const eqIdx = stripped.indexOf("=");
    if (eqIdx <= 0) {
      opts.onWarn?.(`env file line ${i + 1}: no '=' — skipping`);
      continue;
    }

    const key = stripped.slice(0, eqIdx).trim();
    if (!VALID_KEY.test(key)) {
      opts.onWarn?.(`env file line ${i + 1}: invalid key '${key}' — skipping`);
      continue;
    }

    let value = stripped.slice(eqIdx + 1);
    // Strip exactly one pair of matching outer quotes — anything inside is
    // treated as literal, including `#` (so quoted values can contain it).
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      // Unquoted — strip trailing whitespace only (don't touch leading, in case
      // someone has `KEY= value` with a space they actually want kept after =).
      // Standard dotenv strips both sides; matching that is fine too.
      value = value.trim();
    }

    out[key] = value;
  }
  return out;
}

/**
 * Read and parse a `.env` file. Missing files return an empty object (with a
 * warn) so a stale config entry doesn't break `bn start`.
 */
export function readEnvFile(
  filePath: string,
  opts: ParseEnvOptions = {},
): Record<string, string> {
  if (!existsSync(filePath)) {
    opts.onWarn?.(`env file not found: ${filePath} — skipping`);
    return {};
  }
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (err) {
    opts.onWarn?.(`cannot read env file ${filePath}: ${(err as Error).message}`);
    return {};
  }
  return parseEnvText(text, opts);
}
