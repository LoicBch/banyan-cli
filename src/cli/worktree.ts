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
import { testStop } from "../commands/testStop.js";
import { assignTask } from "../commands/assignTask.js";
import { ALL_AGENT_MODES, isAgentMode, type AgentMode } from "../agentPrompt.js";
import { generateSlug } from "../slug.js";
import { UsageError } from "../errors.js";
import { resolveFeatureFromCwd } from "../location.js";


export function register(
  projectCmd: Command,
  project: ProjectConfig,
  config: Config,
): void {
  projectCmd
    .command("wt [branch] [repos...]")
    .description(
      "spin up a feature environment. no repos = all (git worktrees + compose stacks + one claude agent). with repos = only those. " +
        "no branch = create a draft worktree (branch named draft-<ts>); the agent must call banyan_finalize_feature_name " +
        "after your first prompt to pick the real name. " +
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
      "branch prefix instead of the default 'feature' (e.g. --prefix fix → fix/<branch>). pass '' for no prefix.",
    )
    .option(
      "-m, --mode <mode>",
      `agent mode: ${ALL_AGENT_MODES.join(" | ")}. default: autonomous if --prompt is given, interactive otherwise.`,
    )
    .option(
      "--review-plan",
      "gate the agent: it must build a TODO list and request approval before working. you approve via `bn <project> approve <branch>`. orthogonal to --mode (combine with autonomous or autopilot).",
    )
    .action(
      async (
        feature: string | undefined,
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
        // Feature naming flow, in priority order:
        //   1. explicit name → use it as-is
        //   2. `--prompt "..."` + no name → infer slug from prompt, create wt
        //      at the proper name from the start (slug-first, no draft)
        //   3. no name + no prompt → create a DRAFT worktree, launch claude
        //      directly in it. The agent calls banyan_finalize_feature_name
        //      after the first user message; docker stacks are deferred until
        //      then so they start with the real name.
        let effectiveFeature = feature;
        if (!effectiveFeature) {
          if (opts.prompt) {
            logger.info(`inferring feature name from prompt…`);
            effectiveFeature = await generateSlug(opts.prompt);
            logger.ok(`feature name: ${effectiveFeature}`);
          } else {
            const { generateDraftFeature } = await import("../naming.js");
            effectiveFeature = generateDraftFeature();
            logger.info(
              `no prompt — opening claude in a draft worktree (${effectiveFeature}).`,
            );
            logger.info(
              `tell the agent what you want; it will pick the real feature name and rename everything.`,
            );
          }
        }
        if (!effectiveFeature) {
          // Unreachable in practice — earlier branches either set it or
          // returned early. Belt-and-suspenders for TS narrowing.
          throw new UsageError("could not determine feature name");
        }
        await wtAll(config, project.name, effectiveFeature, {
          ...(repos.length > 0 ? { only: repos } : {}),
          ...(opts.prompt ? { initialPrompt: opts.prompt } : {}),
          ...(opts.prefix !== undefined ? { prefix: opts.prefix } : {}),
          ...(mode !== undefined ? { mode } : {}),
          ...(opts.reviewPlan ? { requireApproval: true } : {}),
        });
      },
    );

  // Hidden subcommand wired by `bn wt` when the user is inside tmux. The
  // interactive "describe your task" pane runs banyan as a SUBPROCESS (not
  // exec) to:
  //   1. Infer the slug from the typed prompt
  //   2. Create the worktrees + state files + launch script
  //   3. Print the launch script path to stdout
  // The bash caller then captures the printed path and `exec bash <path>` —
  // the pane's bash IS replaced by claude, no banyan process to suicide.
  projectCmd
    .command("_wt-stage-from-prompt <prompt>", { hidden: true })
    .description("(internal) infer slug + prep wt + write launch script. prints script path on stdout.")
    .option("--repos <repos...>", "limit to these repos")
    .option("--prefix <prefix>", "branch prefix")
    .option("-m, --mode <mode>", "agent mode")
    .option("--review-plan", "require plan approval before work starts")
    .action(
      async (
        prompt: string,
        opts: {
          repos?: string[];
          prefix?: string;
          mode?: string;
          reviewPlan?: boolean;
        },
      ) => {
        const paneId = process.env.TMUX_PANE;
        if (!paneId) {
          throw new UsageError("_wt-stage-from-prompt must be run from within a tmux pane");
        }
        let mode: AgentMode | undefined;
        if (opts.mode && isAgentMode(opts.mode)) mode = opts.mode;

        // logger writes go to stderr by default — keep stdout clean for the
        // launch-script path the bash caller will capture.
        process.stderr.write("inferring feature name from prompt…\n");
        const feature = await generateSlug(prompt);
        process.stderr.write(`feature name: ${feature}\n`);

        const { launchScriptPath } = await wtAll(config, project.name, feature, {
          ...(opts.repos && opts.repos.length > 0 ? { only: opts.repos } : {}),
          initialPrompt: prompt,
          ...(opts.prefix !== undefined ? { prefix: opts.prefix } : {}),
          ...(mode !== undefined ? { mode } : {}),
          ...(opts.reviewPlan ? { requireApproval: true } : {}),
          inheritPaneId: paneId,
          stagedLaunch: true,
        });

        if (!launchScriptPath) {
          throw new UsageError("staged launch produced no script path — bug");
        }
        // ONLY emit the path on stdout. The bash caller does `SCRIPT=$(...)`.
        process.stdout.write(launchScriptPath + "\n");
      },
    );

  projectCmd
    .command("task <branch> <prompt>")
    .description("send a prompt to the per-feature claude agent (paste-and-submit into the existing pane)")
    .option("-f, --force", "send even if claude isn't detected as running in the pane")
    .action(async (feature: string, prompt: string, opts: { force?: boolean }) => {
      const { paneId } = await assignTask(config, project.name, feature, prompt, {
        force: opts.force,
      });
      logger.ok(`prompt sent to ${feature} (${paneId})`);
    });

  projectCmd
    .command("wt-rm [branch] [repo]")
    .description("remove worktree (keep branch local + remote) and close pane. branch is inferred from cwd when omitted in a worktree. omit repo to act on all worktrees of this feature")
    .option(
      "-f, --force",
      "remove worktree even with uncommitted changes (branch is still kept)",
    )
    .action(async (feature: string | undefined, repo: string | undefined, opts: { force?: boolean }) => {
      const feat = resolveFeatureFromCwd(config, project.name, feature, "wt-rm");
      const repos = await resolveRepos(getProject(config, project.name), feat, repo);
      for (const r of repos) {
        if (repos.length > 1) logger.info(`=== ${r} ===`);
        await wtRm(
          await buildContext(config, project.name, { feature: feat, repoName: r }),
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
    .command("rebase [branch] [repo]")
    .description("fetch + rebase the worktree on its base branch. branch is inferred from cwd when omitted in a worktree. omit repo to rebase all worktrees of this branch.")
    .option("-b, --base <branch>", "override base branch (default: repo baseBranch / origin/HEAD / main)")
    .action(async (feature: string | undefined, repo: string | undefined, opts: { base?: string }) => {
      const feat = resolveFeatureFromCwd(config, project.name, feature, "rebase");
      const repos = await resolveRepos(getProject(config, project.name), feat, repo);
      for (const r of repos) {
        if (repos.length > 1) logger.info(`=== ${r} ===`);
        await rebase(
          await buildContext(config, project.name, { feature: feat, repoName: r }),
          { base: opts.base },
        );
      }
    });

  projectCmd
    .command("merge [branch] [repo]")
    .description(
      "push + create MR/PR + merge (GitLab/GitHub). branch is inferred from cwd when omitted in a worktree. " +
        "always pre-flights a local rebase first and runs the headless claude resolver on conflicts " +
        "(cross-feature aware). --local for the offline path, --no-resolve to opt out of auto-resolution.",
    )
    .option("-b, --base <branch>", "override base branch (default: repo baseBranch / origin/HEAD / main)")
    .option("--local", "skip the MR/PR flow, merge locally as before")
    .option("--wait", "wait for CI to pass, then auto-merge")
    .option("--draft", "create MR as draft (don't attempt to merge)")
    .option("--open", "open the MR/PR in the browser after creating")
    .option(
      "--no-resolve",
      "on conflict during pre-flight, don't run the claude resolver — pause for manual fix",
    )
    .action(
      async (
        feature: string | undefined,
        repo: string | undefined,
        opts: {
          base?: string;
          local?: boolean;
          wait?: boolean;
          draft?: boolean;
          open?: boolean;
          resolve?: boolean;
        },
      ) => {
        const feat = resolveFeatureFromCwd(config, project.name, feature, "merge");
        const repos = await resolveRepos(getProject(config, project.name), feat, repo);
        for (const r of repos) {
          if (repos.length > 1) logger.info(`=== ${r} ===`);
          await merge(
            await buildContext(config, project.name, { feature: feat, repoName: r }),
            {
              base: opts.base,
              local: opts.local,
              wait: opts.wait,
              draft: opts.draft,
              open: opts.open,
              // commander turns --no-resolve into opts.resolve === false
              noResolve: opts.resolve === false,
            },
          );
        }
      },
    );

  projectCmd
    .command("cleanup [branch] [repo]")
    .description(
      "full teardown of a feature: stop running tests + remove worktree(s) + delete branch (safe) + " +
        "close pane + stop compose stack and drop volumes. branch is inferred from cwd when omitted in a worktree. " +
        "omit repo to cleanup everything across the project.",
    )
    .option(
      "-f, --force",
      "remove worktree even with uncommitted changes; force-delete branch even with unmerged commits",
    )
    .action(async (feature: string | undefined, repo: string | undefined, opts: { force?: boolean }) => {
      const feat = resolveFeatureFromCwd(config, project.name, feature, "cleanup");
      // Full project cleanup also includes compose stacks. With an explicit
      // repo, we only act on that one (the user knows what they're doing).
      const repos = await resolveRepos(
        getProject(config, project.name),
        feat,
        repo,
        { includeCompose: !repo },
      );

      // Stop the feature's run processes BEFORE removing worktrees. testStop
      // kills the test-<feature> window and runs each repo's stopCommand
      // (e.g. ./gradlew --stop) from within its worktree — so the worktree
      // must still exist when this runs. We only do this for whole-feature
      // cleanups; with an explicit `repo` arg, the user is doing surgery on
      // one repo and the other panes should keep running.
      const isFullCleanup = !repo && repos.length > 0;
      if (isFullCleanup) {
        try {
          await testStop(
            await buildContext(config, project.name),
            feat,
          );
        } catch (err) {
          // Best-effort: if test-stop fails (no window, stopCommand errors,
          // etc.), keep going with the cleanup — the user wants the
          // worktrees gone either way.
          logger.warn(
            `auto test-stop before cleanup failed (continuing): ${(err as Error).message}`,
          );
        }
      }

      for (const r of repos) {
        if (repos.length > 1) logger.info(`=== ${r} ===`);
        await cleanup(
          await buildContext(config, project.name, { feature: feat, repoName: r }),
          { force: opts.force },
        );
      }
    });
}
