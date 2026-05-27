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

export class GitLabProvider implements PRProvider {
  readonly name: ProviderName = "gitlab";
  readonly cli = "glab";

  matchesRemote(url: string): boolean {
    // Covers gitlab.com, self-hosted gitlab.*, git@gitlab-like SSH URLs.
    return /gitlab\./.test(url);
  }

  async checkReady(): Promise<string | undefined> {
    const which = await run("which", ["glab"]);
    if (which.code !== 0) {
      return "glab CLI not found. Install with: brew install glab";
    }
    const auth = await run("glab", ["auth", "status"]);
    if (auth.code !== 0) {
      return "glab not authenticated. Run: glab auth login";
    }
    return undefined;
  }

  async create(repoPath: string, branch: string, opts: CreateMROpts): Promise<{ url: string }> {
    const args = [
      "mr", "create",
      "--source-branch", branch,
      "--target-branch", opts.baseBranch,
      "--title", opts.title,
    ];
    if (opts.body) args.push("--description", opts.body);
    if (opts.draft) args.push("--draft");
    if (opts.removeSourceBranch ?? true) args.push("--remove-source-branch");
    for (const l of opts.labels ?? []) args.push("--label", l);
    for (const r of opts.reviewers ?? []) args.push("--reviewer", r);
    args.push("--yes"); // skip interactive prompts

    const r = await run("glab", args, { cwd: repoPath });
    if (r.code !== 0) {
      throw new Error(`glab mr create failed:\n${r.stderr || r.stdout}`);
    }
    // Output contains the URL on a line
    const url = extractUrl(r.stdout + "\n" + r.stderr);
    if (!url) throw new Error(`could not parse MR URL from glab output:\n${r.stdout}`);
    return { url };
  }

  async status(repoPath: string, branch: string): Promise<MRStatus> {
    // glab mr view --source-branch <branch> --output json
    const r = await run(
      "glab",
      ["mr", "view", branch, "--output", "json"],
      { cwd: repoPath },
    );
    if (r.code !== 0) {
      // No MR for this branch
      if (/no open merge request/i.test(r.stderr) || /not found/i.test(r.stderr)) {
        return { exists: false, state: "unknown" };
      }
      return { exists: false, state: "unknown", rawMessage: r.stderr.trim() };
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(r.stdout);
    } catch {
      return { exists: false, state: "unknown", rawMessage: "invalid JSON from glab" };
    }

    const url = String(data["web_url"] ?? "");
    const stateStr = String(data["state"] ?? "");
    const hasConflicts = Boolean(data["has_conflicts"]);
    const mergeStatus = String(data["detailed_merge_status"] ?? data["merge_status"] ?? "");
    const pipeline = (data["head_pipeline"] ?? data["pipeline"]) as Record<string, unknown> | undefined;
    const pipelineStatus = pipeline ? String(pipeline["status"] ?? "") : undefined;
    const draft = Boolean(data["draft"] ?? data["work_in_progress"]);
    const mergedAt = data["merged_at"] ? String(data["merged_at"]) : undefined;

    let state: MRStatus["state"] = "unknown";
    if (stateStr === "merged") state = "mergeable"; // historical; caller checks mergedAt
    else if (hasConflicts) state = "conflicts";
    else if (draft) state = "draft";
    else if (pipelineStatus && ["running", "pending", "created"].includes(pipelineStatus)) state = "ci_pending";
    else if (pipelineStatus && ["failed", "canceled"].includes(pipelineStatus)) state = "ci_failed";
    else if (mergeStatus === "mergeable" || mergeStatus === "can_be_merged" || (!hasConflicts && !draft))
      state = "mergeable";

    return {
      exists: true,
      url,
      state,
      mergedAt,
      ciPipelineStatus: pipelineStatus,
      rawMessage: mergeStatus || undefined,
    };
  }

  async merge(repoPath: string, branch: string, opts: MergeOpts): Promise<MRResult> {
    const args = ["mr", "merge", branch, "--yes"];
    if (opts.strategy === "squash") args.push("--squash");
    if (opts.strategy === "rebase") args.push("--rebase");
    if (opts.waitForCI) args.push("--when-pipeline-succeeds");
    if (opts.removeSourceBranch ?? true) args.push("--remove-source-branch");

    const r = await run("glab", args, { cwd: repoPath });
    if (r.code !== 0) {
      throw new Error(`glab mr merge failed:\n${r.stderr || r.stdout}`);
    }
    // Try to get URL from status
    const st = await this.status(repoPath, branch);
    return {
      mergedAt: st.mergedAt ?? new Date().toISOString(),
      url: st.url ?? "",
    };
  }

  async openInBrowser(repoPath: string, branch: string): Promise<void> {
    await runInherit("glab", ["mr", "view", branch, "--web"], { cwd: repoPath });
  }

  async metadata(repoPath: string, branch: string): Promise<MRMetadata | undefined> {
    // `glab mr view --output json` already returns most fields; diff stats need
    // a separate `glab mr diff` call which we skip for now (kept fast).
    const r = await run(
      "glab",
      ["mr", "view", branch, "--output", "json"],
      { cwd: repoPath },
    );
    if (r.code !== 0) return undefined;
    try {
      const d = JSON.parse(r.stdout) as Record<string, unknown>;
      const author = (d.author as { username?: string } | undefined)?.username;
      const changes =
        typeof d.changes_count === "string"
          ? parseInt(d.changes_count, 10)
          : (typeof d.changes_count === "number" ? d.changes_count : undefined);
      return {
        ...(typeof d.title === "string" ? { title: d.title } : {}),
        ...(typeof d.description === "string" ? { body: d.description } : {}),
        ...(author ? { author } : {}),
        ...(changes !== undefined && !Number.isNaN(changes) ? { filesChanged: changes } : {}),
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
