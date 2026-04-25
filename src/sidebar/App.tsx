import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { Config } from "../config.js";
import {
  type SidebarProject,
  type SidebarSnapshot,
  loadSnapshot,
} from "./data.js";

interface Props {
  config: Config;
  refreshMs?: number;
}

// Tree row "kinds" for navigation + expand/collapse logic.
type Row =
  | { kind: "project"; project: SidebarProject }
  | { kind: "repo"; project: SidebarProject; repoIndex: number }
  | { kind: "worktree"; project: SidebarProject; repoIndex: number; wtIndex: number };

export const SidebarApp: React.FC<Props> = ({ config, refreshMs = 2000 }) => {
  const [snapshot, setSnapshot] = useState<SidebarSnapshot | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(config.projects.map((p) => p.name)),
  );
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const { exit } = useApp();

  // Refresh loop
  useEffect(() => {
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;

    const tick = async () => {
      try {
        const next = await loadSnapshot(config);
        if (!cancelled) setSnapshot(next);
      } catch (err) {
        if (!cancelled) {
          setSnapshot({
            projects: [],
            error: err instanceof Error ? err.message : String(err),
            fetchedAt: Date.now(),
          });
        }
      }
      if (!cancelled) timer = setTimeout(tick, refreshMs);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [config, refreshMs]);

  // Build the flat visible row list based on current expansion state.
  const rows = useMemo<Row[]>(() => {
    if (!snapshot) return [];
    const out: Row[] = [];
    for (const project of snapshot.projects) {
      out.push({ kind: "project", project });
      if (!expandedProjects.has(project.name)) continue;
      for (let rIdx = 0; rIdx < project.repos.length; rIdx++) {
        out.push({ kind: "repo", project, repoIndex: rIdx });
        const repoKey = `${project.name}/${project.repos[rIdx]!.name}`;
        if (!expandedRepos.has(repoKey)) continue;
        for (let wIdx = 0; wIdx < project.repos[rIdx]!.worktrees.length; wIdx++) {
          out.push({ kind: "worktree", project, repoIndex: rIdx, wtIndex: wIdx });
        }
      }
    }
    return out;
  }, [snapshot, expandedProjects, expandedRepos]);

  // Clamp cursor to valid range whenever rows change.
  useEffect(() => {
    if (cursor >= rows.length && rows.length > 0) setCursor(rows.length - 1);
    if (cursor < 0) setCursor(0);
  }, [rows.length, cursor]);

  // Keyboard handling
  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(c + 1, Math.max(0, rows.length - 1)));
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (key.return || input === " " || key.rightArrow || key.leftArrow) {
      toggleCurrent(key.leftArrow ? "collapse" : key.rightArrow ? "expand" : "toggle");
      return;
    }
    if (input === "r") {
      // trigger immediate refresh by resetting snapshot
      setSnapshot(null);
      loadSnapshot(config).then(setSnapshot).catch(() => {});
      return;
    }
  });

  const current = rows[cursor];

  const toggleCurrent = (mode: "toggle" | "expand" | "collapse") => {
    if (!current) return;
    if (current.kind === "project") {
      setExpandedProjects((prev) => applyMode(prev, current.project.name, mode));
    } else if (current.kind === "repo") {
      const key = `${current.project.name}/${current.project.repos[current.repoIndex]!.name}`;
      setExpandedRepos((prev) => applyMode(prev, key, mode));
    }
    // Worktrees: leaf, no toggle.
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Header loading={snapshot === null} error={snapshot?.error} />

      <Box flexDirection="column" marginTop={1}>
        {rows.length === 0 && snapshot !== null && (
          <Text color="gray">no projects configured — edit ~/.config/banyan/config.yaml</Text>
        )}
        {rows.map((row, i) => (
          <RowView key={rowKey(row)} row={row} active={i === cursor}
            projectExpanded={row.kind !== "worktree" && expandedProjects.has(
              row.kind === "project" ? row.project.name : row.project.name
            )}
            repoExpanded={row.kind === "repo" && expandedRepos.has(
              `${row.project.name}/${row.project.repos[row.repoIndex]!.name}`
            )}
          />
        ))}
      </Box>

      <Footer />
    </Box>
  );
};

function applyMode(set: Set<string>, key: string, mode: "toggle" | "expand" | "collapse"): Set<string> {
  const next = new Set(set);
  if (mode === "expand") next.add(key);
  else if (mode === "collapse") next.delete(key);
  else {
    if (next.has(key)) next.delete(key);
    else next.add(key);
  }
  return next;
}

function rowKey(row: Row): string {
  if (row.kind === "project") return `p:${row.project.name}`;
  if (row.kind === "repo") return `r:${row.project.name}/${row.project.repos[row.repoIndex]!.name}`;
  return `w:${row.project.name}/${row.project.repos[row.repoIndex]!.name}/${row.project.repos[row.repoIndex]!.worktrees[row.wtIndex]!.feature}`;
}

const Header: React.FC<{ loading: boolean; error?: string }> = ({ loading, error }) => (
  <Box>
    <Text color="cyan" bold>banyan</Text>
    <Text color="gray">  {loading ? "loading…" : error ? `error: ${error}` : ""}</Text>
  </Box>
);

const Footer: React.FC = () => (
  <Box marginTop={1} flexDirection="column">
    <Text color="gray">
      <Text color="white">↑↓/jk</Text> move  <Text color="white">→←/enter</Text> expand  <Text color="white">r</Text> refresh  <Text color="white">q</Text> quit
    </Text>
    <Text color="gray">
      tmux: <Text color="white">⌥W</Text> worktree  <Text color="white">⌥M</Text> merge  <Text color="white">⌥C</Text> cleanup  <Text color="white">⌥T</Text> test  <Text color="white">⌥?</Text> all
    </Text>
  </Box>
);

const RowView: React.FC<{
  row: Row;
  active: boolean;
  projectExpanded: boolean;
  repoExpanded: boolean;
}> = ({ row, active, projectExpanded, repoExpanded }) => {
  if (row.kind === "project") {
    const p = row.project;
    const totalWt = p.repos.reduce((s, r) => s + r.worktrees.length, 0);
    const running = p.repos.reduce((s, r) => s + r.worktrees.filter((w) => w.paneStatus === "running").length, 0);
    return (
      <Text>
        <Cursor active={active} />
        <Text color={projectExpanded ? "cyan" : "gray"}>{projectExpanded ? "▾ " : "▸ "}</Text>
        <Text bold color={p.sessionRunning ? "greenBright" : undefined}>{p.name}</Text>
        <Text color="gray">  [{p.repos.length} repos · {totalWt} worktree{totalWt === 1 ? "" : "s"}{running > 0 ? ` · ${running} live` : ""}]</Text>
      </Text>
    );
  }
  if (row.kind === "repo") {
    const r = row.project.repos[row.repoIndex]!;
    return (
      <Text>
        <Cursor active={active} />
        <Text>   </Text>
        <Text color={repoExpanded ? "cyan" : "gray"}>{repoExpanded ? "▾ " : "▸ "}</Text>
        <Text>{r.name}</Text>
        {r.worktrees.length > 0 && <Text color="gray">  ({r.worktrees.length})</Text>}
        {r.baseBranch && <Text color="gray">  · base: {r.baseBranch}</Text>}
      </Text>
    );
  }
  const wt = row.project.repos[row.repoIndex]!.worktrees[row.wtIndex]!;
  return (
    <Text>
      <Cursor active={active} />
      <Text>      </Text>
      <StatusDot status={wt.paneStatus} />
      <Text>{wt.feature}</Text>
      <Text color="gray">  {wt.branch}</Text>
    </Text>
  );
};

const Cursor: React.FC<{ active: boolean }> = ({ active }) =>
  active ? <Text color="magentaBright">❯ </Text> : <Text>  </Text>;

const StatusDot: React.FC<{ status: "running" | "idle" | "missing" }> = ({ status }) => {
  if (status === "running") return <Text color="greenBright">● </Text>;
  if (status === "missing") return <Text color="red">✗ </Text>;
  return <Text color="gray">○ </Text>;
};
