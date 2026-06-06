/**
 * "Create project" wizard — 3 steps: name → add repos → review/submit.
 *
 * Backend: GET /api/tech-profiles, GET /api/fs/list, POST /api/fs/probe,
 * POST /api/projects. All disabled in --remote mode (the backend returns 403),
 * so the wizard surfaces that error gracefully if encountered.
 */
import * as React from "react";
import { toast } from "sonner";
import { Folder, FolderOpen, ArrowLeft, ArrowRight, CheckCircle2, X } from "lucide-react";
import { openDialog } from "@/lib/imperative-dialog";
import { ThemeProvider } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DialogShell, DialogHeader, DialogBody, DialogFooter } from "@/components/ui/dialog-shell";

interface TechProfile {
  id: string;
  label: string;
  hint: string;
  defaults: { command?: string; port?: number; portEnv?: string; setup?: string; stopCommand?: string };
}

interface RepoDraft {
  name: string;
  path: string;
  baseBranch: string;
  tech: string;
  run: { command: string; port: number | null; portEnv: string; setup: string; stopCommand: string };
}

export function openProjectWizard(): void {
  openDialog((close) => (
    <ThemeProvider>
      <ProjectWizardBody close={close} />
    </ThemeProvider>
  ));
}

function ProjectWizardBody({ close }: { close: () => void }): React.JSX.Element {
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [name, setName] = React.useState("");
  const [repos, setRepos] = React.useState<RepoDraft[]>([]);
  const [profiles, setProfiles] = React.useState<TechProfile[]>([]);

  React.useEffect(() => {
    fetch("/api/tech-profiles")
      .then((r) => r.json())
      .then((d) => setProfiles(d.profiles ?? []))
      .catch(() => toast.error("Could not load tech profiles"));
  }, []);

  return (
    <DialogShell onClose={close}>
      <DialogHeader subtitle="banyan will write the config and detect tech for each repo.">
        New project · step {step} / 3
      </DialogHeader>

      {step === 1 ? (
        <StepName name={name} setName={setName} onNext={() => setStep(2)} onCancel={close} />
      ) : step === 2 ? (
        <StepRepos
          projectName={name}
          repos={repos}
          setRepos={setRepos}
          profiles={profiles}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      ) : (
        <StepReview
          name={name}
          repos={repos}
          profiles={profiles}
          onBack={() => setStep(2)}
          onSubmit={close}
        />
      )}
    </DialogShell>
  );
}

// ── Step 1: project name ──────────────────────────────────────────────────

function StepName({ name, setName, onNext, onCancel }: {
  name: string; setName: (s: string) => void; onNext: () => void; onCancel: () => void;
}): React.JSX.Element {
  return (
    <>
      <DialogBody>
        <div className="space-y-1.5">
          <Label htmlFor="proj-name">Project name</Label>
          <Input
            id="proj-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.trim())}
            placeholder="myproject"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            The identifier you'll use everywhere: <code className="text-foreground">bn {name || "<name>"} start</code>
          </p>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          onClick={() => {
            if (!name) { toast.error("Project name is required"); return; }
            if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
              toast.error("Name must match [A-Za-z0-9_.-]+");
              return;
            }
            onNext();
          }}
          className="gap-1.5"
        >
          Next <ArrowRight className="size-4" />
        </Button>
      </DialogFooter>
    </>
  );
}

// ── Step 2: repos ─────────────────────────────────────────────────────────

function StepRepos({
  projectName,
  repos,
  setRepos,
  profiles,
  onBack,
  onNext,
}: {
  projectName: string;
  repos: RepoDraft[];
  setRepos: React.Dispatch<React.SetStateAction<RepoDraft[]>>;
  profiles: TechProfile[];
  onBack: () => void;
  onNext: () => void;
}): React.JSX.Element {
  function addRepo() {
    openRepoEditor(profiles, null, (r) => setRepos((rs) => [...rs, r]));
  }
  function editRepo(idx: number) {
    openRepoEditor(profiles, repos[idx]!, (r) => setRepos((rs) => rs.map((x, i) => (i === idx ? r : x))));
  }
  function removeRepo(idx: number) {
    setRepos((rs) => rs.filter((_, i) => i !== idx));
  }

  return (
    <>
      <DialogBody>
        <div className="text-xs text-muted-foreground">
          Repos that make up <span className="font-mono text-foreground">{projectName}</span>
        </div>
        <div className="space-y-2">
          {repos.map((r, i) => {
            const profile = profiles.find((p) => p.id === r.tech);
            return (
              <div key={i} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm">{r.name}</span>
                      <Badge variant="info">{profile?.label ?? r.tech}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{r.path}</div>
                    {r.run.command ? (
                      <div className="text-xs text-muted-foreground font-mono truncate">$ {r.run.command}</div>
                    ) : null}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => editRepo(i)}>Edit</Button>
                    <Button variant="ghost" size="icon" onClick={() => removeRepo(i)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          <Button variant="outline" onClick={addRepo} className="w-full gap-1.5">
            <FolderOpen className="size-4" /> Add repo
          </Button>
          {repos.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center pt-2">
              Add at least one repo to continue.
            </p>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Button
          onClick={() => {
            if (repos.length === 0) { toast.error("Add at least one repo"); return; }
            onNext();
          }}
          className="gap-1.5"
          disabled={repos.length === 0}
        >
          Review <ArrowRight className="size-4" />
        </Button>
      </DialogFooter>
    </>
  );
}

// ── Repo editor sub-dialog ────────────────────────────────────────────────

function openRepoEditor(
  profiles: TechProfile[],
  initial: RepoDraft | null,
  onSubmit: (r: RepoDraft) => void,
): void {
  openDialog((close) => (
    <ThemeProvider>
      <RepoEditorBody profiles={profiles} initial={initial} close={close} onSubmit={onSubmit} />
    </ThemeProvider>
  ));
}

function RepoEditorBody({
  profiles,
  initial,
  close,
  onSubmit,
}: {
  profiles: TechProfile[];
  initial: RepoDraft | null;
  close: () => void;
  onSubmit: (r: RepoDraft) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState<RepoDraft>(
    initial ?? { name: "", path: "", baseBranch: "", tech: "custom", run: { command: "", port: null, portEnv: "", setup: "", stopCommand: "" } },
  );

  async function probe(target?: string) {
    const p = (target ?? draft.path).trim();
    if (!p) return;
    try {
      const r = await fetch("/api/fs/probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: p }),
      });
      const data = await r.json();
      if (!r.ok || !data.valid) {
        toast.error("Invalid path", { description: data.error ?? "rejected" });
        return;
      }
      setDraft((d) => {
        const tech = data.suggestedTech ?? d.tech ?? "custom";
        const profile = profiles.find((x) => x.id === tech);
        const sug = data.suggestedRun ?? profile?.defaults ?? {};
        return {
          ...d,
          path: data.path,
          name: d.name || data.suggestedName,
          tech,
          run: {
            command: sug.command ?? d.run.command,
            port: sug.port ?? d.run.port,
            portEnv: sug.portEnv ?? d.run.portEnv,
            setup: sug.setup ?? d.run.setup,
            stopCommand: sug.stopCommand ?? d.run.stopCommand,
          },
        };
      });
      toast.info("Detected", { description: data.stackLabel ?? `tech: ${data.suggestedTech ?? "custom"}` });
    } catch (err) {
      toast.error("Probe failed", { description: String(err) });
    }
  }

  function selectTech(id: string) {
    const profile = profiles.find((p) => p.id === id);
    setDraft((d) => ({
      ...d,
      tech: id,
      run: {
        command: profile?.defaults.command ?? d.run.command,
        port: profile?.defaults.port ?? d.run.port,
        portEnv: profile?.defaults.portEnv ?? d.run.portEnv,
        setup: profile?.defaults.setup ?? d.run.setup,
        stopCommand: profile?.defaults.stopCommand ?? d.run.stopCommand,
      },
    }));
  }

  function submit() {
    if (!draft.name) { toast.error("Repo name is required"); return; }
    if (!draft.path) { toast.error("Repo path is required"); return; }
    onSubmit(draft);
    close();
  }

  return (
    <DialogShell onClose={close} className="w-[min(95vw,38rem)]">
      <DialogHeader>{initial ? "Edit repo" : "Add repo"}</DialogHeader>
      <DialogBody>
        <div className="space-y-1.5">
          <Label>Path</Label>
          <div className="flex gap-2">
            <Input
              value={draft.path}
              onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
              placeholder="~/Documents/Dev/MyApp/Front"
              className="font-mono flex-1"
            />
            <Button variant="outline" onClick={() => openFsBrowser((picked) => probe(picked))} className="gap-1.5">
              <Folder className="size-4" /> Browse
            </Button>
            <Button variant="outline" onClick={() => probe()}>Detect</Button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Repo name</Label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.trim() }))}
            placeholder="front, back, app, …"
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Tech</Label>
          <div className="flex flex-wrap gap-1.5">
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => selectTech(p.id)}
                className={
                  p.id === draft.tech
                    ? "px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground"
                    : "px-2.5 py-1 text-xs rounded-md bg-secondary text-secondary-foreground hover:bg-accent"
                }
                title={p.hint}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Base branch</Label>
          <Input
            value={draft.baseBranch}
            onChange={(e) => setDraft((d) => ({ ...d, baseBranch: e.target.value.trim() }))}
            placeholder="main / develop / …"
            className="font-mono"
          />
        </div>
        <div className="pt-2 border-t border-border space-y-3">
          <div className="space-y-1.5">
            <Label>Run command</Label>
            <Input
              value={draft.run.command}
              onChange={(e) => setDraft((d) => ({ ...d, run: { ...d.run, command: e.target.value } }))}
              placeholder="npm run dev"
              className="font-mono"
            />
          </div>
          <div className="flex gap-3">
            <div className="space-y-1.5 w-28">
              <Label>Port</Label>
              <Input
                type="number"
                value={draft.run.port ?? ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setDraft((d) => ({ ...d, run: { ...d.run, port: Number.isFinite(n) ? n : null } }));
                }}
                placeholder="3000"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5 flex-1">
              <Label>Port env</Label>
              <Input
                value={draft.run.portEnv}
                onChange={(e) => setDraft((d) => ({ ...d, run: { ...d.run, portEnv: e.target.value.trim() } }))}
                placeholder="PORT, SERVER_PORT, …"
                className="font-mono"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Stop command (optional)</Label>
            <Input
              value={draft.run.stopCommand}
              onChange={(e) => setDraft((d) => ({ ...d, run: { ...d.run, stopCommand: e.target.value.trim() } }))}
              placeholder="./gradlew --stop"
              className="font-mono"
            />
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={submit}>{initial ? "Save" : "Add repo"}</Button>
      </DialogFooter>
    </DialogShell>
  );
}

// ── FS browser sub-dialog ─────────────────────────────────────────────────

function openFsBrowser(onPick: (path: string) => void): void {
  openDialog((close) => (
    <ThemeProvider>
      <FsBrowserBody onPick={onPick} close={close} />
    </ThemeProvider>
  ));
}

function FsBrowserBody({ onPick, close }: { onPick: (path: string) => void; close: () => void }): React.JSX.Element {
  const [path, setPath] = React.useState<string | null>(null);
  const [entries, setEntries] = React.useState<Array<{ name: string; isDir: boolean; isGitRepo: boolean }>>([]);
  const [parent, setParent] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load(target: string | null) {
    setError(null);
    try {
      const url = "/api/fs/list" + (target ? "?path=" + encodeURIComponent(target) : "");
      const r = await fetch(url);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `${r.status}`);
      setPath(data.path);
      setEntries(data.entries);
      setParent(data.parent);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  React.useEffect(() => { load(null); }, []);

  return (
    <DialogShell onClose={close} className="w-[min(95vw,36rem)]">
      <DialogHeader>Pick a directory</DialogHeader>
      <DialogBody>
        <div className="text-xs font-mono text-muted-foreground break-all">{path ?? "loading…"}</div>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        <div className="rounded-md border border-border divide-y divide-border max-h-72 overflow-y-auto">
          {parent ? (
            <button
              onClick={() => load(parent)}
              className="w-full px-3 py-1.5 text-left text-sm font-mono text-muted-foreground hover:bg-accent transition-colors"
            >
              ..
            </button>
          ) : null}
          {entries.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground italic">(empty)</div>
          ) : (
            entries.map((e) => (
              <button
                key={e.name}
                onClick={() => path && load(path + "/" + e.name)}
                className="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-accent transition-colors"
              >
                <span className="font-mono text-sm">{e.name}</span>
                {e.isGitRepo ? <Badge variant="success">git</Badge> : null}
              </button>
            ))
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button
          onClick={() => {
            if (path) { onPick(path); close(); }
          }}
          disabled={!path}
        >
          Pick this folder
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}

// ── Step 3: review + submit ───────────────────────────────────────────────

function StepReview({
  name,
  repos,
  profiles,
  onBack,
  onSubmit,
}: {
  name: string;
  repos: RepoDraft[];
  profiles: TechProfile[];
  onBack: () => void;
  onSubmit: () => void;
}): React.JSX.Element {
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    const body = {
      name,
      repos: repos.map((r) => ({
        name: r.name,
        path: r.path,
        ...(r.baseBranch ? { baseBranch: r.baseBranch } : {}),
        tech: r.tech,
        ...(r.run.command
          ? {
              run: {
                command: r.run.command,
                ...(r.run.port ? { port: r.run.port } : {}),
                ...(r.run.portEnv ? { portEnv: r.run.portEnv } : {}),
                ...(r.run.setup ? { setup: r.run.setup } : {}),
                ...(r.run.stopCommand ? { stopCommand: r.run.stopCommand } : {}),
              },
            }
          : {}),
      })),
    };
    try {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (r.ok && data.ok) {
        toast.success(`Project '${data.name}' created`);
        onSubmit();
      } else {
        toast.error("Create failed", { description: data.error ?? `${r.status}` });
        setBusy(false);
      }
    } catch (err) {
      toast.error("Create failed", { description: String(err) });
      setBusy(false);
    }
  }

  return (
    <>
      <DialogBody>
        <div className="text-xs text-muted-foreground">Review and create</div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">Project</div>
          <div className="font-mono text-sm">{name}</div>
        </div>
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Repos ({repos.length})</div>
          {repos.map((r) => {
            const profile = profiles.find((p) => p.id === r.tech);
            return (
              <div key={r.name} className="rounded-md border border-border p-2.5 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{r.name}</span>
                  <Badge variant="info">{profile?.label ?? r.tech}</Badge>
                </div>
                <div className="text-xs font-mono text-muted-foreground">{r.path}</div>
                {r.run.command ? (
                  <div className="text-xs font-mono text-muted-foreground">$ {r.run.command}</div>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          banyan will write this to <code className="text-foreground">~/.config/banyan/config.yaml</code>,
          preserving existing comments.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Button onClick={submit} disabled={busy} className="gap-1.5">
          <CheckCircle2 className="size-4" />
          {busy ? "Creating…" : "Create project"}
        </Button>
      </DialogFooter>
    </>
  );
}
