/**
 * Stylized terminal demo — fake but believable session showing the core loop.
 *
 * Lines are pre-rendered (no typing animation in v1). Commands in foreground,
 * output dimmed. The "traffic light" header is purely decorative.
 *
 * BorderBeam wraps the whole frame to give it that "premium dev tool" feel.
 */
import { BorderBeam } from "@/components/BorderBeam";

type Line =
  | { kind: "cmd"; text: string; project?: string }
  | { kind: "out"; text: string; tone?: "success" | "info" | "muted" }
  | { kind: "comment"; text: string }
  | { kind: "blank" };

const SESSION: Line[] = [
  { kind: "comment", text: "# A morning with banyan" },
  { kind: "cmd", text: "bn myproject wt profile-page", project: "myproject" },
  { kind: "out", text: "✓ worktrees created in front, back, app", tone: "success" },
  { kind: "out", text: "✓ .env.local seeded into each worktree", tone: "success" },
  { kind: "out", text: "✓ agent pane opened (mode=autonomous)", tone: "success" },
  { kind: "blank" },
  { kind: "cmd", text: "bn myproject start profile-page" },
  { kind: "out", text: "back  : SERVER_PORT=8081 ./gradlew bootRun", tone: "info" },
  { kind: "out", text: "front : PORT=3001 npm run dev", tone: "info" },
  { kind: "out", text: "app   : adb reverse 8080→8081", tone: "info" },
  { kind: "blank" },
  { kind: "comment", text: "# Bug report — open a parallel context" },
  { kind: "cmd", text: 'bn myproject wt tag-filter -p "fix infinite loop"' },
  { kind: "out", text: "✓ feature/tag-filter on :3002 :8082 (isolated DB)", tone: "success" },
  { kind: "blank" },
  { kind: "cmd", text: "bn myproject merge tag-filter" },
  { kind: "out", text: "✓ rebased · pushed · MR #127 merged", tone: "success" },
  { kind: "cmd", text: "bn myproject cleanup tag-filter" },
  { kind: "out", text: "✓ tests stopped · worktrees removed · branch deleted", tone: "success" },
];

export function Terminal(): React.JSX.Element {
  return (
    <section className="relative py-16 sm:py-20">
      <div className="container">
        <div className="mx-auto max-w-3xl">
          <div className="relative rounded-xl border border-border bg-card/50 shadow-2xl backdrop-blur-sm overflow-hidden">
            <BorderBeam duration={10} size={220} />

            {/* Traffic-light header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-background/40">
              <span className="size-2.5 rounded-full bg-rose-500/70" />
              <span className="size-2.5 rounded-full bg-amber-400/70" />
              <span className="size-2.5 rounded-full bg-emerald-500/70" />
              <span className="ml-3 text-xs text-muted-foreground font-mono">
                ~/Documents/Dev/myproject — banyan
              </span>
            </div>

            {/* Lines */}
            <div className="p-5 sm:p-6 font-mono text-xs sm:text-sm leading-6 overflow-x-auto">
              {SESSION.map((line, i) => (
                <Row key={i} line={line} />
              ))}
              <span className="inline-flex items-center gap-1 text-primary">
                $ <span className="inline-block h-4 w-1.5 bg-primary animate-pulse-slow" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ line }: { line: Line }): React.JSX.Element {
  if (line.kind === "blank") return <div className="h-3" aria-hidden />;
  if (line.kind === "comment") {
    return <div className="text-muted-foreground/70 italic">{line.text}</div>;
  }
  if (line.kind === "cmd") {
    return (
      <div className="text-foreground">
        <span className="text-primary">$</span> <span>{line.text}</span>
      </div>
    );
  }
  const toneClass =
    line.tone === "success" ? "text-emerald-400"
    : line.tone === "info" ? "text-sky-400/80"
    : "text-muted-foreground";
  return <div className={toneClass}>{"  " + line.text}</div>;
}
