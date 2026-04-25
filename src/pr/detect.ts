import { run } from "../exec.js";
import { GitLabProvider } from "./gitlab.js";
import { GitHubProvider } from "./github.js";
import type { PRProvider } from "./types.js";

const providers: PRProvider[] = [new GitLabProvider(), new GitHubProvider()];

/** Get the remote URL for `origin` in a repo. */
export async function getOriginUrl(repoPath: string): Promise<string | undefined> {
  const r = await run("git", ["remote", "get-url", "origin"], { cwd: repoPath });
  if (r.code !== 0) return undefined;
  return r.stdout.trim();
}

/**
 * Detect which PR provider handles the repo's origin remote.
 * Returns undefined if no provider matches (e.g. Bitbucket, custom server, no remote).
 */
export async function detectProvider(repoPath: string): Promise<PRProvider | undefined> {
  const url = await getOriginUrl(repoPath);
  if (!url) return undefined;
  return providers.find((p) => p.matchesRemote(url));
}

/** Debug helper: return the list of supported providers (for help text). */
export function supportedProviders(): string[] {
  return providers.map((p) => `${p.name} (${p.cli})`);
}
