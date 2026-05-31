import { run, runInherit } from "../exec.js";
import type {
  CreateMROpts,
  MergeOpts,
  MRMetadata,
  MRResult,
  MRStatus,
  PRProvider,
  ProviderName,
} from "./types.js";

export class GitHubProvider implements PRProvider {
  readonly name: ProviderName = "github";
  readonly cli = "gh";

  matchesRemote(url: string): boolean {
    return /github\.com/.test(url);
  }

  async checkReady(): Promise<string | undefined> {
    const which = await run("which", ["gh"]);
    if (which.code !== 0) {
      return "gh CLI not found. Install with: brew install gh";
    }
    const auth = await run("gh", ["auth", "status"]);
    if (auth.code !== 0) {
      return "gh not authenticated. Run: gh auth login";
    }
    return undefined;
  }

  async create(repoPath: string, branch: string, opts: CreateMROpts): Promise<{ url: string }> {
    const args = [
      "pr", "create",
      "--head", branch,
      "--base", opts.baseBranch,
      "--title", opts.title,
    ];
    args.push("--body", opts.body ?? "");
    if (opts.draft) args.push("--draft");
    for (const l of opts.labels ?? []) args.push("--label", l);
    for (const r of opts.reviewers ?? []) args.push("--reviewer", r);

    const r = await run("gh", args, { cwd: repoPath });
    if (r.code !== 0) {
      throw new Error(`gh pr create failed:\n${r.stderr || r.stdout}`);
    }
    const url = extractUrl(r.stdout + "\n" + r.stderr);
    if (!url) throw new Error(`could not parse PR URL from gh output:\n${r.stdout}`);
    return { url };
  }

  async status(repoPath: string, branch: string): Promise<MRStatus> {
    const r = await run(
      "gh",
      [
        "pr", "view", branch,
        "--json",
        "state,mergeable,mergeStateStatus,isDraft,url,mergedAt,statusCheckRollup",
      ],
      { cwd: repoPath },
    );
    if (r.code !== 0) {
      if (/no pull requests/i.test(r.stderr) || /not found/i.test(r.stderr)) {
        return { exists: false, state: "unknown" };
      }
      return { exists: false, state: "unknown", rawMessage: r.stderr.trim() };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(r.stdout);
    } catch {
      return { exists: false, state: "unknown", rawMessage: "invalid JSON from gh" };
    }

    const url = String(data["url"] ?? "");
    const mergeable = data["mergeable"];
    const mergeStateStatus = String(data["mergeStateStatus"] ?? "");
    const draft = Boolean(data["isDraft"]);
    const mergedAt = data["mergedAt"] ? String(data["mergedAt"]) : undefined;
    const checks = (data["statusCheckRollup"] ?? []) as Array<Record<string, unknown>>;

    let ciState = "";
    if (checks.length > 0) {
      if (checks.some((c) => c["conclusion"] === "FAILURE")) ciState = "failed";
      else if (checks.some((c) => c["status"] !== "COMPLETED")) ciState = "pending";
      else ciState = "passed";
    }

    let state: MRStatus["state"] = "unknown";
    if (mergedAt) state = "mergeable"; // already merged
    else if (mergeable === "CONFLICTING" || mergeStateStatus === "DIRTY") state = "conflicts";
    else if (draft) state = "draft";
    else if (ciState === "pending") state = "ci_pending";
    else if (ciState === "failed") state = "ci_failed";
    else if (mergeable === "MERGEABLE") state = "mergeable";

    return {
      exists: true,
      url,
      state,
      mergedAt,
      ciPipelineStatus: ciState || undefined,
      rawMessage: mergeStateStatus || undefined,
    };
  }

  async merge(repoPath: string, branch: string, opts: MergeOpts): Promise<MRResult> {
    const args = ["pr", "merge", branch];
    if (opts.strategy === "squash") args.push("--squash");
    else if (opts.strategy === "rebase") args.push("--rebase");
    else args.push("--merge");
    if (opts.waitForCI) args.push("--auto");
    if (opts.removeSourceBranch ?? true) args.push("--delete-branch");

    const r = await run("gh", args, { cwd: repoPath });
    if (r.code !== 0) {
      throw new Error(`gh pr merge failed:\n${r.stderr || r.stdout}`);
    }
    const st = await this.status(repoPath, branch);
    return {
      mergedAt: st.mergedAt ?? new Date().toISOString(),
      url: st.url ?? "",
    };
  }

  async openInBrowser(repoPath: string, branch: string): Promise<void> {
    await runInherit("gh", ["pr", "view", branch, "--web"], { cwd: repoPath });
  }

  async metadata(repoPath: string, branch: string): Promise<MRMetadata | undefined> {
    const r = await run(
      "gh",
      ["pr", "view", branch, "--json", "title,body,author,additions,deletions,files"],
      { cwd: repoPath },
    );
    if (r.code !== 0) return undefined;
    try {
      const d = JSON.parse(r.stdout) as Record<string, unknown>;
      const files = Array.isArray(d.files) ? d.files : [];
      const author = (d.author as { login?: string } | undefined)?.login;
      return {
        ...(typeof d.title === "string" ? { title: d.title } : {}),
        ...(typeof d.body === "string" ? { body: d.body } : {}),
        ...(author ? { author } : {}),
        ...(typeof d.additions === "number" ? { additions: d.additions } : {}),
        ...(typeof d.deletions === "number" ? { deletions: d.deletions } : {}),
        filesChanged: files.length,
      };
    } catch {
      return undefined;
    }
  }
}

function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)]+/);
  return match ? match[0] : undefined;
}
