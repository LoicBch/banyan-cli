/**
 * Runtime helpers that derive values from a parsed config.
 *
 * Separated from the loader/validation so callers that just want to query
 * an already-loaded config don't drag YAML or filesystem code in.
 */
import type { RunConfig } from "./types.js";

/** Resolve the command that `bn test` should actually run for a repo:
 *  the active preset's command if set and valid, otherwise the default. */
export function effectiveRunCommand(run: RunConfig): string {
  if (run.activePreset && run.presets && run.presets[run.activePreset]) {
    return run.presets[run.activePreset]!;
  }
  return run.command;
}
