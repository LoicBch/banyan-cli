import React from "react";
import { render } from "ink";
import type { Config } from "../config.js";
import { SidebarApp } from "../sidebar/App.js";
import * as exec from "../exec.js";

/**
 * `bn sidebar` behavior:
 *   - If NOT in tmux → just render the TUI in the current terminal.
 *   - If IN tmux but not yet in a sidebar pane:
 *       - If a sidebar pane already exists in this session → focus it.
 *       - Otherwise → split the window vertically, spawn `bn sidebar` in the new pane.
 *   - If already IN the sidebar pane (env var set) → render the TUI.
 */
export async function sidebar(config: Config): Promise<void> {
  const inTmux = !!process.env.TMUX;
  const isSidebarPane = process.env.BANYAN_SIDEBAR === "1";

  if (inTmux && !isSidebarPane) {
    // 1. Look for an existing sidebar pane (tagged with @banyan-sidebar=1) in this session.
    const existingPaneId = await findExistingSidebarPane();
    if (existingPaneId) {
      await exec.run("tmux", ["select-pane", "-t", existingPaneId]);
      return;
    }

    // 2. Otherwise, split vertically and spawn a new bn sidebar inside.
    const newPaneId = await splitForSidebar();
    if (newPaneId) {
      // Tag the pane so a future `bn sidebar` invocation focuses this one.
      await exec.run("tmux", [
        "set-option", "-p", "-t", newPaneId, "@banyan-sidebar", "1",
      ]);
    }
    return;
  }

  // Either outside tmux, or we're already inside the sidebar pane → render.
  const { waitUntilExit } = render(<SidebarApp config={config} />);
  await waitUntilExit();
}

async function findExistingSidebarPane(): Promise<string | undefined> {
  const r = await exec.run("tmux", [
    "list-panes", "-s",
    "-F", "#{pane_id}\t#{@banyan-sidebar}",
  ]);
  if (r.code !== 0) return undefined;
  for (const line of r.stdout.split("\n")) {
    const [id, flag] = line.split("\t");
    if (flag === "1" && id) return id;
  }
  return undefined;
}

async function splitForSidebar(): Promise<string | undefined> {
  // Build a command that re-runs `bn sidebar` with BANYAN_SIDEBAR=1 set so the
  // child invocation skips the split logic and renders the TUI.
  const binPath = process.argv[1] ?? "bn";
  // -h: horizontal split (left/right)
  // -b: place the new pane BEFORE (i.e. to the left of) the current pane
  // -l 40: 40 cols wide
  const r = await exec.run("tmux", [
    "split-window", "-hb", "-l", "40",
    "-c", process.env.PWD ?? process.cwd(),
    "-e", "BANYAN_SIDEBAR=1",
    "-P", "-F", "#{pane_id}",
    `${binPath} sidebar`,
  ]);
  if (r.code !== 0) return undefined;
  return r.stdout.trim();
}
