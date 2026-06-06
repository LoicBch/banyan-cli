/**
 * Top navigation — sticky, semi-transparent backdrop blur, minimal.
 *
 * Banyan logo (text + dot mark) on the left, GitHub link on the right.
 * No anchor links to other sections — the page is short enough that the
 * user can scroll, and link soup hurts the visual.
 */
import Link from "next/link";
import { Github } from "lucide-react";

export function Nav(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary text-sm font-bold transition-transform group-hover:scale-110">
            ◐
          </span>
          <span className="text-sm font-semibold tracking-tight">banyan</span>
          <span className="hidden sm:inline rounded-full bg-secondary px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
            v0.1
          </span>
        </Link>
        <nav className="flex items-center gap-1">
          <a
            href="#features"
            className="hidden sm:inline-block px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Features
          </a>
          <a
            href="#how"
            className="hidden sm:inline-block px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            How it works
          </a>
          <a
            href="https://github.com/LoicBch/banyan-cli"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-foreground hover:bg-accent rounded-md transition-colors"
          >
            <Github className="size-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
