/**
 * Hero — the headline + subhead + CTAs.
 *
 * Density: tight, big-tagline-first. Subtle grid background + radial mask
 * gives depth without distraction. The headline uses an animated gradient
 * to feel premium without being garish.
 */
import Link from "next/link";
import { ArrowRight, Github, Sparkles } from "lucide-react";
import { CopyableCode } from "@/components/CopyableCode";

export function Hero(): React.JSX.Element {
  return (
    <section className="relative overflow-hidden">
      {/* Grid background */}
      <div className="absolute inset-0 bg-grid pointer-events-none" />
      {/* Top radial glow */}
      <div
        aria-hidden
        className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/4 size-[800px] rounded-full bg-primary/10 blur-3xl pointer-events-none"
      />

      <div className="container relative pt-20 pb-24 sm:pt-28 sm:pb-32">
        <div className="mx-auto max-w-3xl text-center space-y-8 animate-fade-in">
          {/* Pill */}
          <a
            href="https://github.com/LoicBch/banyan-cli/releases"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3.5 py-1.5 text-xs backdrop-blur-sm hover:border-primary/50 transition-colors"
          >
            <Sparkles className="size-3 text-primary" />
            <span className="text-muted-foreground">
              v0.1 — open source, MIT licensed
            </span>
            <ArrowRight className="size-3 text-muted-foreground" />
          </a>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.05] text-gradient">
            Parallel features.<br />
            One stack. One brain.
          </h1>

          {/* Subhead */}
          <p className="mx-auto max-w-2xl text-base sm:text-lg text-muted-foreground leading-relaxed">
            banyan compresses the whole multi-repo dev loop into a single CLI.
            One feature spans every repo, gets its own Claude agent, its own
            ports, its own docker stack — so you can run{" "}
            <span className="text-foreground font-medium">10 AI agents in parallel</span>{" "}
            without ever stepping on yourself.
          </p>

          {/* CTAs */}
          <div className="flex items-center justify-center gap-3 flex-wrap pt-2">
            <Link
              href="https://github.com/LoicBch/banyan-cli"
              target="_blank"
              className="group inline-flex items-center gap-2 h-11 px-5 rounded-md bg-primary text-primary-foreground font-medium glow-primary hover:bg-primary/90 transition-all"
            >
              <Github className="size-4" />
              Get started
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="#how"
              className="inline-flex items-center gap-2 h-11 px-5 rounded-md border border-border bg-card/50 text-foreground hover:bg-accent transition-colors"
            >
              How it works
            </Link>
          </div>

          {/* One-line install */}
          <div className="pt-6">
            <CopyableCode>git clone https://github.com/LoicBch/banyan-cli && cd banyan-cli && npm i && npm run build && npm link</CopyableCode>
          </div>
        </div>
      </div>
    </section>
  );
}
