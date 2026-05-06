/**
 * Per-project worktree + git ops: wt, wt-rm, wt-ls, rebase, merge, cleanup.
 */
import type { Command } from "commander";
import type { Config, ProjectConfig } from "../config.js";
import { buildContext, resolveRepos } from "../context.js";
import { getProject } from "../config.js";
import { logger } from "../logger.js";
import { wtAll } from "../commands/wtAll.js";
import { wtRm } from "../commands/wtRm.js";
import { wtLs } from "../commands/wtLs.js";
import { rebase } from "../commands/rebase.js";
import { merge } from "../commands/merge.js";
import { cleanup } from "../commands/cleanup.js";
import { assignTask } from "../commands/assignTask.js";
import { ALL_AGENT_MODES, isAgentMode, type AgentMode } from "../agentPrompt.js";
import { UsageError } from "../errors.js";

export function register(
  projectCmd: Command,
  project: ProjectConfig,
  config: Config,
): void {
  projectCmd
    .command("wt <feature> [repos...]")
    .description(
      "spin up a feature environment. no repos = all (git worktrees + compose stacks + one claude agent). with repos = only those. " +
        "agent mode controls autonomy: interactive (plain claude, you drive), assisted (asks on big decisions), " +
        "autonomous (decides everything, documents hesitations), autopilot (autonomous + works through TODO list, " +
        "loops until banyan_report_done).",
    )
    .option(
      "-p, --prompt <prompt>",
      "first message sent to the per-feature claude agent (only on a fresh session). implies --mode autonomous unless overridden.",
    )
    .option(
      "--prefix <prefix>",
      "branch prefix instead of the default 'feature' (e.g. --prefix fix → fix/<feature>). pass '' for no prefix.",
    )
    .option(
      "-m, --mode <mode>",
      `agent mode: ${ALL_AGENT_MODES.join(" | ")}. default: autonomous if --prompt is given, interactive otherwise.`,
    )
    .option(
      "--review-plan",
      "gate the agent: it must build a TODO list and request approval before working. you approve via `bn <project> approve <feature>`. orthogonal to --mode (combine with autonomous or autopilot).",
    )
    .action(
      async (
        feature: string,
        repos: string[],
        opts: {
          prompt?: string;
          prefix?: string;
          mode?: string;
          reviewPlan?: boolean;
        },
      ) => {
        let mode: AgentMode | undefined;
        if (opts.mode !== undefined) {
          if (!isAgentMode(opts.mode)) {
            throw new UsageError(
              `unknown mode '${opts.mode}'. valid: ${ALL_AGENT_MODES.join(", ")}`,
            );
          }
          mode = opts.mode;
        }
        await wtAll(config, project.name, feature, {
          ...(repos.length > 0 ? { only: repos } : {}),
          ...(opts.prompt ? { initialPrompt: opts.prompt } : {}),
          ...(opts.prefix !== undefined ? { prefix: opts.prefix } : {}),
          ...(mode !== undefined ? { mode } : {}),
          ...(opts.reviewPlan ? { requireApproval: true } : {}),
        });
      },
    );

  projectCmd
    .command("task <feature> <prompt>")
    .description("send a prompt to the per-feature claude agent (paste-and-submit into the existing pane)")
    .option("-f, --force", "send even if claude isn't detected as running in the pane")
    .action(async (feature: string, prompt: string, opts: { force?: boolean }) => {
      const { paneId } = await assignTask(config, project.name, feature, prompt, {
        force: opts.force,
      });
      logger.ok(`prompt sent to ${feature} (${paneId})`);
    });

  projectCmd
    .command("wt-rm <feature> [repo]")
    .description("remove worktree (keep branch local + remote) and close pane. omit repo to act on all worktrees of this feature")
    .option(
      "-f, --force",
      "remove worktree even with uncommitted changes (branch is still kept)",
    )
    .action(async (feature: string, repo: string | undefined, opts: { force?: boolean }) => {
      const repos = resolveRepos(getProject(config, project.name), feature, repo);
      for (const r of repos) {
        if (repos.length > 1) logger.info(`=== ${r} ===`);
        await wtRm(
          await buildContext(config, project.name, { feature, repoName: r }),
          { force: opts.force },
        );
      }
    });

  projectCmd
    .command("wt-ls")
    .description("list worktrees across all repos")
    .action(async () => {
      await wtLs(await buildContext(config, project.name));
    });

  projectCmd
    .command("rebase <feature> [repo]")
    .description("fetch + rebase worktree on base branch. omit repo to rebase all worktrees of this feature")
    .option("-b, --base <branch>", "override base branch (default: repo baseBranch / origin/HEAD / main)")
    .action(async (feature: string, repo: string | undefined, opts: { base?: string }) => {
      const repos = resolveRepos(getProject(config, project.name), feature, repo);
      for (const r of repos) {
        if (repos.length > 1) logger.info(`=== ${r} ===`);
        await rebase(
          await buildContext(config, project.name, { feature, repoName: r }),
          { base: opts.base },
        );
      }
    });

  projectCmd
    .command("merge <feature> [repo]")
    .description("push + create MR/PR + merge (GitLab/GitHub). --local to skip the MR flow.")
    .option("-b, --base <branch>", "override base branch (default: repo baseBranch / origin/HEAD / main)")
    .option("--local", "skip the MR/PR flow, merge locally as before")
    .option("--wait", "wait for CI to pass, then auto-merge")
    .option("--draft", "create MR as draft (don't attempt to merge)")
    .option("--open", "open the MR/PR in the browser after creating")
    .option(
      "--strategy <strategy>",
      "merge strategy: squash | merge | rebase (default: squash)",
      "squash",
    )
    .option(
      "--skip-preflight",
      "skip the local rebase / conflict preview before pushing",
    )
    .option(
      "--auto-resolve",
      "on conflict, launch the claude resolver without asking",
    )
    .action(
      async (
        feature: string,
        repo: string | undefined,
        opts: {
          base?: string;
          local?: boolean;
          wait?: boolean;
          draft?: boolean;
          open?: boolean;
          strategy?: "squash" | "merge" | "rebase";
          skipPreflight?: boolean;
          autoResolve?: boolean;
        },
      ) => {
        const repos = resolveRepos(getProject(config, project.name), feature, repo);
        for (const r of repos) {
          if (repos.length > 1) logger.info(`=== ${r} ===`);
          await merge(
            await buildContext(config, project.name, { feature, repoName: r }),
            {
              base: opts.base,
              local: opts.local,
              wait: opts.wait,
              draft: opts.draft,
              open: opts.open,
              strategy: opts.strategy,
              skipPreflight: opts.skipPreflight,
              autoResolve: opts.autoResolve,
            },
          );
        }
      },
    );

  projectCmd
    .command("cleanup <feature> [repo]")
    .description("remove worktree + delete branch (safe) + close pane. omit repo to cleanup all worktrees of this feature")
    .option(
      "-f, --force",
      "remove worktree even with uncommitted changes; force-delete branch even with unmerged commits",
    )
    .action(async (feature: string, repo: string | undefined, opts: { force?: boolean }) => {
      const repos = resolveRepos(getProject(config, project.name), feature, repo);
      for (const r of repos) {
        if (repos.length > 1) logger.info(`=== ${r} ===`);
        await cleanup(
          await buildContext(config, project.name, { feature, repoName: r }),
          { force: opts.force },
        );
      }
    });
}
