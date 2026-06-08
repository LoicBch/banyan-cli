/**
 * Left sidebar — navigation between sections + project switcher + theme toggle.
 *
 * Density goal: tight enough to scan many projects, but breathable spacing
 * around section headers so it doesn't read as cramped. Active section has
 * a subtle primary-tinted background, not a hard accent.
 */
import * as React from "react";
import { LayoutDashboard, Inbox, History, MessageSquare, Settings, Keyboard, Sun, Moon, FolderTree, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { openProjectWizard } from "@/components/ProjectWizard";

export type SectionId = "pipeline" | "inbox" | "history" | "ask" | "config" | "shortcuts";

interface SidebarProps {
  section: SectionId;
  onSection: (id: SectionId) => void;
  projects: string[];
  activeProject: string | null;
  onProject: (name: string) => void;
}

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ReactNode }> = [
  { id: "pipeline", label: "Pipeline", icon: <LayoutDashboard className="size-4" /> },
  { id: "inbox", label: "Inbox", icon: <Inbox className="size-4" /> },
  { id: "history", label: "History", icon: <History className="size-4" /> },
  { id: "ask", label: "Ask", icon: <MessageSquare className="size-4" /> },
  { id: "config", label: "Config", icon: <Settings className="size-4" /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard className="size-4" /> },
];

export function Sidebar({ section, onSection, projects, activeProject, onProject }: SidebarProps): React.JSX.Element {
  const { theme, toggle } = useTheme();

  return (
    <aside className="flex h-full w-60 flex-col border-r border-border bg-card">
      {/* Brand row */}
      <div className="flex h-14 items-center gap-2 px-4 border-b border-border">
        <div className="size-6 rounded bg-primary/15 flex items-center justify-center text-primary text-sm font-bold">
          ◐
        </div>
        <span className="text-sm font-semibold tracking-tight">banyan</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          live
        </span>
      </div>

      {/* Sections */}
      <nav className="flex-1 overflow-y-auto p-2">
        <div className="mb-1 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Workspace
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => onSection(s.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              section === s.id
                ? "bg-primary/10 text-primary-foreground text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {s.icon}
            {s.label}
          </button>
        ))}

        {projects.length > 0 ? (
          <>
            <div className="mt-4 mb-1 flex items-center justify-between pl-2 pr-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Projects
              </span>
              <button
                onClick={openProjectWizard}
                className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-500 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition-colors"
                title="Create a new banyan project"
              >
                <Plus className="size-3" />
                New
              </button>
            </div>
            {projects.map((p) => (
              <button
                key={p}
                onClick={() => onProject(p)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors font-mono",
                  activeProject === p
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <FolderTree className="size-4" />
                {p}
              </button>
            ))}
          </>
        ) : null}
      </nav>

      {/* Footer: theme toggle */}
      <div className="border-t border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={toggle}
          title="Toggle theme"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </Button>
      </div>
    </aside>
  );
}
