/**
 * Shared options + helpers for the merge flow modules.
 */

export interface MergeOpts {
  base?: string;
  /** Skip PR/MR flow, do a local merge instead. */
  local?: boolean;
  /** Wait for CI to pass and auto-merge. */
  wait?: boolean;
  /** Create the MR as draft (no auto-merge). */
  draft?: boolean;
  /** Open the MR in the browser after creating. */
  open?: boolean;
  /** When pre-flight finds conflicts, opt out of the headless claude
   *  resolver. Default behaviour (without this flag) launches the
   *  resolver. The resolver is cross-feature aware via --add-dir on
   *  every parent dir of the project, so it produces decisions
   *  consistent with what other in-flight features have done. */
  noResolve?: boolean;
}

export function humanizeFeatureTitle(feature: string): string {
  return feature
    .split(/[-_]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
