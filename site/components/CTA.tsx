/**
 * Final CTA — large card with gradient background, headline, two buttons.
 * Sits right before the footer to convert visitors into installers.
 */
import Link from "next/link";
import { ArrowRight, Github } from "lucide-react";

export function CTA(): React.JSX.Element {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="container">
        <div className="relative mx-auto max-w-4xl rounded-2xl border border-border bg-card/40 backdrop-blur-sm overflow-hidden">
          {/* Subtle accent gradient inside the card */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5 pointer-events-none"
          />
          <div
            aria-hidden
            className="absolute -top-1/2 left-1/2 -translate-x-1/2 size-[600px] rounded-full bg-primary/10 blur-3xl pointer-events-none"
          />

          <div className="relative p-10 sm:p-14 text-center space-y-6">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-xl mx-auto">
              Ready to ship parallel features?
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              banyan is open source, MIT licensed, and runs on any macOS or
              Linux machine with tmux, git, and Claude Code installed.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap pt-2">
              <Link
                href="https://github.com/LoicBch/banyan-cli"
                target="_blank"
                className="group inline-flex items-center gap-2 h-11 px-5 rounded-md bg-primary text-primary-foreground font-medium glow-primary hover:bg-primary/90 transition-all"
              >
                <Github className="size-4" />
                View on GitHub
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="https://github.com/LoicBch/banyan-cli#install"
                target="_blank"
                className="inline-flex items-center gap-2 h-11 px-5 rounded-md border border-border bg-background/70 text-foreground hover:bg-accent transition-colors"
              >
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
