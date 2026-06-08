/**
 * Left sidebar — navigation between sections + project switcher + theme toggle.
 *
 * Density goal: tight enough to scan many projects, but breathable spacing
 * around section headers so it doesn't read as cramped. Active section has
 * a subtle primary-tinted background, not a hard accent.
 *
 * Each project row has a chevron that expands to show its configured repos
 * with their tech-stack icon. Persisted in localStorage per project so the
 * expansion state survives reloads.
 */
import * as React from "react";
import {
  LayoutDashboard,
  Inbox,
  History,
  MessageSquare,
  Settings,
  Keyboard,
  Sun,
  Moon,
  FolderTree,
  Plus,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";
import { openProjectWizard } from "@/components/ProjectWizard";
import { TechIcon, techLabel } from "@/components/TechIcon";
import type { ProjectState } from "@/lib/api";

export type SectionId = "pipeline" | "inbox" | "history" | "ask" | "config" | "shortcuts";

interface SidebarProps {
  section: SectionId;
  onSection: (id: SectionId) => void;
  projects: ProjectState[];
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

const STORAGE_EXPANDED = "banyan.web.sidebar.expanded";

export function Sidebar({ section, onSection, projects, activeProject, onProject }: SidebarProps): React.JSX.Element {
  const { theme, toggle } = useTheme();

  // Per-project expansion state. Stored as `Record<projectName, boolean>` in
  // localStorage. Default: collapsed.
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_EXPANDED);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_EXPANDED, JSON.stringify(expanded));
    } catch {
      /* quota exceeded — non-fatal */
    }
  }, [expanded]);

  function toggleExpanded(name: string): void {
    setExpanded((s) => ({ ...s, [name]: !s[name] }));
  }

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
            {projects.map((p) => {
              const isOpen = !!expanded[p.name];
              const isActive = activeProject === p.name;
              return (
                <div key={p.name} className="mb-0.5">
                  <div
                    className={cn(
                      "group flex items-center rounded-md transition-colors",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    {/* Chevron toggle — separate hitbox from the project button */}
                    <button
                      onClick={() => toggleExpanded(p.name)}
                      className="flex items-center justify-center size-6 rounded-l-md hover:text-foreground"
                      title={isOpen ? "Collapse" : "Expand"}
                      aria-label={isOpen ? "Collapse repos" : "Expand repos"}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    {/* Project name — activating it switches the active project */}
                    <button
                      onClick={() => onProject(p.name)}
                      className="flex flex-1 items-center gap-2 px-1 py-1.5 text-sm font-mono text-left"
                    >
                      <FolderTree className="size-4" />
                      {p.name}
                      <span className="ml-auto text-[10px] text-muted-foreground/70">
                        {p.repos.length}
                      </span>
                    </button>
                  </div>

                  {isOpen ? (
                    <div className="ml-5 mt-0.5 mb-1 border-l border-border/60 pl-2 space-y-0.5">
                      {p.repos.length === 0 ? (
                        <div className="px-2 py-1 text-[11px] italic text-muted-foreground/60">
                          no repos
                        </div>
                      ) : (
                        p.repos.map((r) => (
                          <div
                            key={r.name}
                            className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground"
                            title={r.path}
                          >
                            <TechIcon tech={r.tech} type={r.type} className="text-muted-foreground/70" />
                            <span className="font-mono truncate">{r.name}</span>
                            {techLabel(r.tech, r.type) ? (
                              <span className="ml-auto text-[10px] text-muted-foreground/50 shrink-0">
                                {techLabel(r.tech, r.type)}
                              </span>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
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
