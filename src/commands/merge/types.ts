/**
 * Shared options + helpers for the merge flow modules.
 */

export interface MergeOpts {
  base?: string;
  /** Skip PR/MR flow, do a local merge instead. */
  local?: boolean;
  /** Wait for CI to pass and auto-merge. */
  wait?: boolean;
  /** Merge strategy when using the PR/MR flow. */
  strategy?: "squash" | "merge" | "rebase";
  /** Create the MR as draft (no auto-merge). */
  draft?: boolean;
  /** Open the MR in the browser after creating. */
  open?: boolean;
  /** Skip the pre-flight local rebase / conflict resolution step. */
  skipPreflight?: boolean;
  /** When pre-flight finds conflicts, launch the claude resolver without asking. */
  autoResolve?: boolean;
}

export function humanizeFeatureTitle(feature: string): string {
  return feature
    .split(/[-_]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
