/**
 * Shell quoting helpers — used whenever banyan composes a command string for
 * `tmux send-keys`, an inline `claude` invocation, or any other place where
 * we hand a fully-formed shell command to the OS.
 *
 * Single-quote strategy: wrap the whole value in single quotes and escape
 * embedded single quotes by closing, escaping, and reopening
 * (`'\''`). Works under bash/zsh/sh equivalently.
 */

const SAFE_PATTERN = /^[A-Za-z0-9_:/.@=+,-]+$/;

/**
 * Quote `s` for use as a shell argument. Pass-through for values that match
 * a "safe" character class; otherwise wrap in single quotes with embedded
 * quotes escaped.
 */
export function shellQuote(s: string): string {
  if (SAFE_PATTERN.test(s)) return s;
  return `'${shellEscapeSingleQuoted(s)}'`;
}

/**
 * Escape a value for placement INSIDE an already single-quoted shell string.
 * Only escapes the lone "'" character (closes-and-reopens) — the caller is
 * responsible for the surrounding quotes. Used when emitting `key='<value>'`
 * pairs that the shell will parse with its own quoting.
 */
export function shellEscapeSingleQuoted(s: string): string {
  return s.replace(/'/g, `'\\''`);
}
