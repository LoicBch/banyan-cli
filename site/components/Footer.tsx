/**
 * Footer — minimal: brand on the left, links on the right.
 * No copyright cruft. No newsletter form. Just routes to the resources
 * that exist.
 */
import { Github } from "lucide-react";

export function Footer(): React.JSX.Element {
  return (
    <footer className="border-t border-border/40 mt-12">
      <div className="container py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary text-sm font-bold">
            ◐
          </span>
          <span className="text-sm font-semibold tracking-tight">banyan</span>
          <span className="text-xs text-muted-foreground">· MIT</span>
        </div>
        <nav className="flex items-center gap-1 flex-wrap text-sm">
          <a
            href="https://github.com/LoicBch/banyan-cli"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Github className="size-4" />
            GitHub
          </a>
          <a
            href="https://github.com/LoicBch/banyan-cli/issues"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            Issues
          </a>
          <a
            href="https://github.com/LoicBch/banyan-cli/blob/develop/CHANGELOG.md"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            Changelog
          </a>
          <a
            href="https://github.com/LoicBch/banyan-cli/blob/develop/LICENSE"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            License
          </a>
        </nav>
      </div>
    </footer>
  );
}
