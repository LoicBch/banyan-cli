export class BanyanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends BanyanError {}
export class UsageError extends BanyanError {}
export class GitError extends BanyanError {}
export class TmuxError extends BanyanError {}
