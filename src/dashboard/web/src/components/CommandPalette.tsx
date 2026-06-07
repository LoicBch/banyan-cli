/**
 * Cmd/Ctrl+K command palette.
 *
 * No `cmdk` package — a 100-line palette covers the navigation use case.
 * Built-in commands: navigate to a section, switch project, theme toggle,
 * new feature, new project.
 *
 * Keyboard:
 *   ⌘K / Ctrl+K     toggle
 *   ↑ ↓             move selection
 *   Enter           run
 *   Esc             close
 */
import * as React from "react";
import { Search, ArrowRight, Sun, Moon, Plus, FolderTree, LayoutDashboard, Inbox, History, MessageSquare, Settings, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { openProjectWizard } from "@/components/ProjectWizard";
import { openWorktreeDialog } from "@/components/WorktreeDialog";
import { useDialogMark } from "@/lib/imperative-dialog";
import type { SectionId } from "@/components/Sidebar";

interface CommandPaletteProps {
  section: SectionId;
  onSection: (id: SectionId) => void;
  projects: string[];
  onProject: (name: string) => void;
}

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  group: "Navigation" | "Project" | "Actions" | "Theme";
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette({ section: _section, onSection, projects, onProject }: CommandPaletteProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState(0);
  const { theme, toggle } = useTheme();
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Mark this as an open dialog so the global keyboard hook stays quiet
  // while the palette is on-screen.
  useDialogMark(open);

  // Global hotkey: ⌘K / Ctrl+K toggles.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus the input on open.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const commands: Cmd[] = React.useMemo(() => {
    const navTargets: Array<{ id: SectionId; label: string; icon: React.ReactNode }> = [
      { id: "pipeline", label: "Go to Pipeline", icon: <LayoutDashboard className="size-4" /> },
      { id: "inbox", label: "Go to Inbox", icon: <Inbox className="size-4" /> },
      { id: "history", label: "Go to History", icon: <History className="size-4" /> },
      { id: "ask", label: "Go to Ask", icon: <MessageSquare className="size-4" /> },
      { id: "config", label: "Go to Config", icon: <Settings className="size-4" /> },
      { id: "shortcuts", label: "Go to Shortcuts", icon: <Keyboard className="size-4" /> },
    ];
    const projectCmds: Cmd[] = projects.map((p) => ({
      id: `project:${p}`,
      label: `Switch to ${p}`,
      hint: "project",
      group: "Project",
      icon: <FolderTree className="size-4" />,
      run: () => { onProject(p); setOpen(false); },
    }));
    return [
      ...navTargets.map<Cmd>((n) => ({
        id: `nav:${n.id}`,
        label: n.label,
        group: "Navigation",
        icon: n.icon,
        run: () => { onSection(n.id); setOpen(false); },
      })),
      ...projectCmds,
      {
        id: "new-feature",
        label: "New feature…",
        hint: "open worktree dialog",
        group: "Actions",
        icon: <Plus className="size-4" />,
        run: () => {
          setOpen(false);
          const proj = projects[0];
          if (proj) openWorktreeDialog(proj);
        },
      },
      {
        id: "new-project",
        label: "New project…",
        hint: "open create-project wizard",
        group: "Actions",
        icon: <Plus className="size-4" />,
        run: () => { setOpen(false); openProjectWizard(); },
      },
      {
        id: "theme",
        label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        group: "Theme",
        icon: theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />,
        run: () => { toggle(); setOpen(false); },
      },
    ];
  }, [onSection, onProject, projects, theme, toggle]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? commands.filter((c) =>
        c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
      )
    : commands;

  // Clamp selection in range.
  React.useEffect(() => {
    if (selected >= filtered.length) setSelected(0);
  }, [filtered.length, selected]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[selected]?.run();
    }
  }

  if (!open) return <></>;

  // Group commands for display.
  const groups: Array<{ name: string; items: Cmd[] }> = [];
  for (const c of filtered) {
    const existing = groups.find((g) => g.name === c.group);
    if (existing) existing.items.push(c);
    else groups.push({ name: c.group, items: [c] });
  }

  // Map selection index → flat index for highlight.
  let flatIdx = -1;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-24 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="bg-card border border-border rounded-lg shadow-2xl w-[min(92vw,38rem)] max-h-[70vh] flex flex-col">
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search className="size-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 h-12 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
          <kbd className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <div className="flex-1 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No matches.
            </div>
          ) : null}
          {groups.map((g) => (
            <div key={g.name} className="mb-1">
              <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {g.name}
              </div>
              {g.items.map((c) => {
                flatIdx++;
                const isSel = flatIdx === selected;
                return (
                  <button
                    key={c.id}
                    onMouseEnter={() => setSelected(flatIdx)}
                    onClick={() => c.run()}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                      isSel ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <span className="text-muted-foreground">{c.icon}</span>
                    <span className="flex-1">{c.label}</span>
                    {c.hint ? <span className="text-xs text-muted-foreground">{c.hint}</span> : null}
                    {isSel ? <ArrowRight className="size-3.5 text-muted-foreground" /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
