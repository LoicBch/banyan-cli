export interface FailureDetails {
  /** One-line human-readable summary shown in the banner. Defaults to message. */
  title?: string;
  /** Why this happened, in plain language. Optional. */
  cause?: string;
  /** Concrete command(s) the user can run to recover. Optional. */
  fix?: string | string[];
}

export class BanyanError extends Error {
  readonly details?: FailureDetails;

  constructor(message: string, details?: FailureDetails) {
    super(message);
    this.name = new.target.name;
    if (details) this.details = details;
  }
}

export class ConfigError extends BanyanError {}
export class UsageError extends BanyanError {}
export class GitError extends BanyanError {}
export class TmuxError extends BanyanError {}
