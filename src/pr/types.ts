/**
 * Platform-agnostic PR/MR abstraction. Each provider (GitLab, GitHub) implements
 * this interface by wrapping its native CLI (`glab`, `gh`).
 */

export type ProviderName = "gitlab" | "github" | "bitbucket" | "unknown";

export type MergeState =
  | "mergeable"              // can merge right now
  | "conflicts"              // merge conflicts
  | "ci_pending"             // CI in progress, not yet mergeable
  | "ci_failed"              // CI failed, mergeable is false
  | "draft"                  // still in draft state
  | "unknown";

export interface MRStatus {
  exists: boolean;
  url?: string;
  state: MergeState;
  mergedAt?: string;
  ciPipelineStatus?: string;
  conflictingFiles?: string[];
  rawMessage?: string;       // human-readable extra info from provider
}

export interface CreateMROpts {
  title: string;
  body?: string;
  baseBranch: string;
  draft?: boolean;
  labels?: string[];
  reviewers?: string[];
  removeSourceBranch?: boolean;
}

export interface MergeOpts {
  strategy?: "squash" | "merge" | "rebase";
  waitForCI?: boolean;
  removeSourceBranch?: boolean;
}

export interface MRResult {
  mergedAt: string;
  url: string;
}

export interface PRProvider {
  readonly name: ProviderName;
  readonly cli: string;                     // "glab" or "gh"

  /** Check if this provider handles a given remote URL. */
  matchesRemote(url: string): boolean;

  /** Check the underlying CLI is installed + authenticated. Returns an error message if not. */
  checkReady(): Promise<string | undefined>;

  /** Create a new MR/PR. Returns the URL. */
  create(repoPath: string, branch: string, opts: CreateMROpts): Promise<{ url: string }>;

  /** Query the current status of the MR/PR for `branch`. */
  status(repoPath: string, branch: string): Promise<MRStatus>;

  /** Merge the MR/PR. Throws on failure. */
  merge(repoPath: string, branch: string, opts: MergeOpts): Promise<MRResult>;

  /** Open the MR/PR in the default browser. */
  openInBrowser(repoPath: string, branch: string): Promise<void>;
}
