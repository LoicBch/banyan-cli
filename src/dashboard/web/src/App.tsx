/**
 * Root of the React dashboard.
 *
 * Composition: ThemeProvider wraps the layout. Sidebar handles nav between
 * sections + project switching. Right pane renders whichever view matches
 * `section`. Pipeline is the only fully-migrated view in this first pass;
 * other sections show a placeholder pointing at the legacy `/legacy/` URL.
 */
import * as React from "react";
import { Toaster } from "sonner";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { Sidebar, type SectionId } from "@/components/Sidebar";
import { Pipeline } from "@/components/Pipeline";
import { Shortcuts } from "@/components/Shortcuts";
import { Inbox } from "@/components/Inbox";
import { History } from "@/components/History";
import { Config } from "@/components/Config";
import { Ask } from "@/components/Ask";
import { CommandPalette } from "@/components/CommandPalette";
import { openKeyboardCheatsheet } from "@/components/KeyboardCheatsheet";
import { openWorktreeDialog } from "@/components/WorktreeDialog";
import { fetchState } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { useKeyboard } from "@/lib/useKeyboard";
import { TooltipProvider } from "@/components/ui/tooltip";

const STORAGE_SECTION = "banyan.web.section";
const STORAGE_PROJECT = "banyan.web.project";

export default function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        <Shell />
        <ThemedToaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}

function ThemedToaster(): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        style: { fontFamily: '"Geist", system-ui, sans-serif' },
      }}
    />
  );
}

function Shell(): React.JSX.Element {
  const [section, setSection] = React.useState<SectionId>(() => {
    const stored = localStorage.getItem(STORAGE_SECTION);
    if (stored && isSection(stored)) return stored;
    return "pipeline";
  });
  const [project, setProject] = React.useState<string | null>(() =>
    localStorage.getItem(STORAGE_PROJECT),
  );
  const [focusRepo, setFocusRepo] = React.useState<{ project: string; repo: string } | null>(null);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_SECTION, section);
  }, [section]);

  React.useEffect(() => {
    if (project) localStorage.setItem(STORAGE_PROJECT, project);
  }, [project]);

  // Pull project state for the sidebar. Cheap because /api/state already
  // polls — we project it here for the full repo list (needed by the
  // expandable repo rows). The command palette only needs names.
  const { data } = usePolling(fetchState, 2000);
  const projects = data?.projects ?? [];
  const projectNames = projects.map((p) => p.name);

  // Default project: persisted choice, else first available.
  const activeProject = project && projectNames.includes(project) ? project : projectNames[0] ?? null;

  // App-level keyboard bindings. View-specific bindings (j/k/s/m/c/a)
  // live in their owning component (Pipeline) — useKeyboard handles the
  // suppression rules so they don't fight.
  useKeyboard({
    "?": () => openKeyboardCheatsheet(),
    n: () => {
      if (activeProject) openWorktreeDialog(activeProject);
    },
  });

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        section={section}
        onSection={setSection}
        projects={projects}
        activeProject={activeProject}
        onProject={(name) => {
          setProject(name);
          // Clicking a project in the sidebar = "go to this project's
          // overview". Always lands on Pipeline so the user sees its
          // features list. Without this, clicking a project while in
          // Config or another section was a no-op visually.
          setSection("pipeline");
          setFocusRepo(null);
        }}
        onRepoClick={(projectName, repoName) => {
          setProject(projectName);
          setSection("config");
          setFocusRepo({ project: projectName, repo: repoName });
        }}
      />
      <main className="flex-1 overflow-y-auto">
        {section === "pipeline" ? <Pipeline projectName={activeProject} /> : null}
        {section === "shortcuts" ? <Shortcuts /> : null}
        {section === "inbox" ? <Inbox /> : null}
        {section === "history" ? <History projectName={activeProject} /> : null}
        {section === "config" ? (
          <Config
            projectName={activeProject}
            focusRepo={focusRepo}
            onFocusConsumed={() => setFocusRepo(null)}
          />
        ) : null}
        {section === "ask" ? <Ask projectName={activeProject} /> : null}
      </main>
      <CommandPalette
        section={section}
        onSection={setSection}
        projects={projectNames}
        onProject={setProject}
      />
    </div>
  );
}

function isSection(s: string): s is SectionId {
  return ["pipeline", "inbox", "history", "ask", "config", "shortcuts"].includes(s);
}
