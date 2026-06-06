/**
 * Features grid — 6 cards in a 3×2 layout (responsive: 1 col mobile, 2 tablet,
 * 3 desktop). Each card has an icon, title, and 1-2 sentence description.
 *
 * Focus on the SIX best-selling features. The README has the full list;
 * the marketing page shows the headline ones. Hierarchy: parallel + agents
 * first (the hook), then env management + dashboard (visible polish), then
 * conflicts + cleanup (the underrated payoff).
 */
import { GitBranch, Bot, KeyRound, LayoutDashboard, Network, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
  accent?: boolean;
}

const FEATURES: Feature[] = [
  {
    icon: GitBranch,
    title: "One feature, every repo",
    body: "bn wt <name> creates a worktree in front, back, mobile — all on the same branch. Same name everywhere. Zero context switching.",
    accent: true,
  },
  {
    icon: Bot,
    title: "Per-feature Claude agent",
    body: "Each worktree gets its own Claude with --add-dir on every repo. A project-wide orchestrator predicts conflicts and drives merges.",
  },
  {
    icon: Network,
    title: "Dynamic ports + DBs",
    body: "10 features on the same machine, each with isolated ports and its own docker stack. Cross-repo env wiring resolves at spawn time.",
  },
  {
    icon: KeyRound,
    title: "Auto-managed .env",
    body: "copyOnWorktree seeds gitignored files. loadEnvFiles injects them as actual env vars — so Spring Boot, Django, plain Node, all see your secrets.",
  },
  {
    icon: LayoutDashboard,
    title: "Web dashboard + remote",
    body: "Pipeline view, conflict pulse, agent reports, integrations inbox. bn serve --remote tunnels via Cloudflare with a QR code for your phone.",
  },
  {
    icon: Trash2,
    title: "One-command teardown",
    body: "bn cleanup stops tests, removes worktrees, deletes branches, drops compose volumes, clears state. Nothing leaks between features.",
  },
];

export function Features(): React.JSX.Element {
  return (
    <section id="features" className="relative py-20 sm:py-28">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center space-y-3 mb-14">
          <div className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            Features
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Everything you need.<br className="sm:hidden" /> Nothing you don't.
          </h2>
          <p className="text-muted-foreground">
            Banyan absorbs the plumbing so you can focus on shipping features in parallel.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px rounded-2xl border border-border bg-border overflow-hidden">
          {FEATURES.map((f) => (
            <FeatureCard key={f.title} feature={f} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ feature }: { feature: Feature }): React.JSX.Element {
  const Icon = feature.icon;
  return (
    <div
      className={cn(
        "group relative bg-background p-6 sm:p-8 transition-colors duration-300 hover:bg-card/50",
      )}
    >
      <div
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-lg",
          feature.accent
            ? "bg-primary/15 text-primary ring-1 ring-primary/20"
            : "bg-secondary text-foreground",
        )}
      >
        <Icon className="size-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-tight">{feature.title}</h3>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{feature.body}</p>
    </div>
  );
}
