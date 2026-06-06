/**
 * Root of the React dashboard.
 *
 * Composition: ThemeProvider wraps the layout. Sidebar handles nav between
 * sections + project switching. Right pane renders whichever view matches
 * `section`. Pipeline is the only fully-migrated view in this first pass;
 * other sections show a placeholder pointing at the legacy `/legacy/` URL.
 */
import * as React from "react";
import { ThemeProvider } from "@/lib/theme";
import { Sidebar, type SectionId } from "@/components/Sidebar";
import { Pipeline } from "@/components/Pipeline";
import { fetchState } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";

const STORAGE_SECTION = "banyan.web.section";
const STORAGE_PROJECT = "banyan.web.project";

export default function App(): React.JSX.Element {
  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
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

  React.useEffect(() => {
    localStorage.setItem(STORAGE_SECTION, section);
  }, [section]);

  React.useEffect(() => {
    if (project) localStorage.setItem(STORAGE_PROJECT, project);
  }, [project]);

  // Pull the project list for the sidebar. Cheap because /api/state already
  // polls — we just project it here. (No second fetch.)
  const { data } = usePolling(fetchState, 2000);
  const projects = data?.projects.map((p) => p.name) ?? [];

  // Default project: persisted choice, else first available.
  const activeProject = project && projects.includes(project) ? project : projects[0] ?? null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        section={section}
        onSection={setSection}
        projects={projects}
        activeProject={activeProject}
        onProject={setProject}
      />
      <main className="flex-1 overflow-y-auto">
        {section === "pipeline" ? (
          <Pipeline projectName={activeProject} />
        ) : (
          <LegacyRedirect section={section} />
        )}
      </main>
    </div>
  );
}

function isSection(s: string): s is SectionId {
  return ["pipeline", "inbox", "history", "ask", "config", "shortcuts"].includes(s);
}

/**
 * Placeholder for sections not yet migrated. Tells the user the view is
 * still available on the legacy dashboard, with a one-click hop. Keeps the
 * incremental-migration story honest.
 */
function LegacyRedirect({ section }: { section: SectionId }): React.JSX.Element {
  const labels: Record<SectionId, string> = {
    pipeline: "Pipeline",
    inbox: "Inbox",
    history: "History",
    ask: "Ask",
    config: "Config",
    shortcuts: "Shortcuts",
  };
  return (
    <div className="mx-auto max-w-2xl p-6 mt-12 animate-fade-in">
      <Card className="border-dashed">
        <CardContent className="py-12 text-center space-y-4">
          <h2 className="text-lg font-semibold">{labels[section]} — coming soon</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            This view hasn't been migrated to the new UI yet. The old version is still
            available on the legacy dashboard.
          </p>
          <Button asChild variant="outline" className="gap-2">
            <a href="/legacy/" target="_self">
              <ExternalLink className="size-4" />
              Open legacy dashboard
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
