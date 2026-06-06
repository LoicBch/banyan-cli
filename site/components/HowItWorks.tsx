/**
 * "How it works" — three steps with subtle connecting line on desktop.
 *
 * Each step has: number badge, title, 1-sentence description, code snippet.
 * The horizontal connecting line is decorative — drawn between steps with a
 * pseudo-element, fades on small screens.
 */
import { cn } from "@/lib/utils";

interface Step {
  num: string;
  title: string;
  body: string;
  command: string;
}

const STEPS: Step[] = [
  {
    num: "01",
    title: "Spin up the feature",
    body: "Worktrees in every repo. Same branch. One agent, --add-dir everywhere.",
    command: "bn myproject wt feature-name",
  },
  {
    num: "02",
    title: "Run it isolated",
    body: "Each repo gets a dynamically-allocated port and its own docker stack.",
    command: "bn myproject start feature-name",
  },
  {
    num: "03",
    title: "Ship and clean",
    body: "Rebase, push, MR, auto-resolve conflicts. Then full teardown.",
    command: "bn myproject merge && cleanup",
  },
];

export function HowItWorks(): React.JSX.Element {
  return (
    <section id="how" className="relative py-20 sm:py-28">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center space-y-3 mb-14">
          <div className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            How it works
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Three commands. Whole flow.
          </h2>
          <p className="text-muted-foreground">
            From context switch to merged feature in three commands.
            Multiply by N for parallel work.
          </p>
        </div>

        <div className="relative mx-auto max-w-5xl grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Decorative connecting line behind cards on desktop */}
          <div
            aria-hidden
            className="hidden lg:block absolute top-12 left-12 right-12 h-px bg-gradient-to-r from-transparent via-border to-transparent"
          />

          {STEPS.map((step, i) => (
            <StepCard key={step.num} step={step} isLast={i === STEPS.length - 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StepCard({ step, isLast }: { step: Step; isLast: boolean }): React.JSX.Element {
  return (
    <div className="relative group">
      <div
        className={cn(
          "relative rounded-xl border border-border bg-card/40 p-6",
          "backdrop-blur-sm transition-all duration-300",
          "hover:border-primary/30 hover:bg-card/60",
        )}
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary font-mono text-sm font-medium">
            {step.num}
          </span>
          {!isLast ? (
            <span className="hidden lg:block text-muted-foreground/50">→</span>
          ) : null}
        </div>
        <h3 className="text-lg font-semibold tracking-tight">{step.title}</h3>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{step.body}</p>
        <div className="mt-4 rounded-md border border-border bg-background/60 px-3 py-2">
          <code className="font-mono text-xs text-foreground">
            <span className="text-primary">$</span> {step.command}
          </code>
        </div>
      </div>
    </div>
  );
}
