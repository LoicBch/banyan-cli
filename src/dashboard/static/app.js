const REFRESH_MS = 2000;

const root = document.getElementById("root");
const statusEl = document.getElementById("status");
const lastRefreshEl = document.getElementById("last-refresh");
const toastHost = document.getElementById("toast-host");

// ── helpers ────────────────────────────────────────────────────────────────
async function fetchState() {
  try {
    const r = await fetch("/api/state");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    return { error: err.message, projects: [], generatedAt: new Date().toISOString() };
  }
}

async function postAction(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

async function getJSON(path) {
  const r = await fetch(path);
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

function pill(text, color) {
  const bg = {
    green: "bg-emerald-900/60 text-emerald-200 ring-emerald-700",
    yellow: "bg-yellow-900/60 text-yellow-200 ring-yellow-700",
    red: "bg-rose-900/60 text-rose-200 ring-rose-700",
    neutral: "bg-neutral-800 text-neutral-300 ring-neutral-700",
    blue: "bg-sky-900/60 text-sky-200 ring-sky-700",
  }[color] || "bg-neutral-800 text-neutral-300 ring-neutral-700";
  return h("span", { class: `inline-flex items-center px-2 py-0.5 text-xs rounded ring-1 ${bg}` }, [text]);
}

function dotPill(text, color = "green") {
  const colorClass = { green: "bg-emerald-400", yellow: "bg-yellow-400", red: "bg-rose-400", neutral: "bg-neutral-500" }[color];
  return h("span", { class: "inline-flex items-center gap-1.5 text-xs text-neutral-400" }, [
    h("span", { class: `w-1.5 h-1.5 rounded-full ${colorClass}` }),
    text,
  ]);
}

function btn(label, { onClick, variant = "default", title, disabled = false } = {}) {
  const variants = {
    default: "bg-neutral-800 hover:bg-neutral-700 text-neutral-200 ring-neutral-700",
    primary: "bg-sky-900 hover:bg-sky-800 text-sky-100 ring-sky-700",
    danger: "bg-rose-900 hover:bg-rose-800 text-rose-100 ring-rose-700",
    success: "bg-emerald-900 hover:bg-emerald-800 text-emerald-100 ring-emerald-700",
  };
  const base = "px-2 py-1 text-xs rounded ring-1 transition font-medium disabled:opacity-40 disabled:cursor-not-allowed";
  const el = h("button", {
    class: `${base} ${variants[variant] || variants.default}`,
    title: title || label,
    onclick: onClick,
  }, [label]);
  if (disabled) el.disabled = true;
  return el;
}

function toast(kind, title, lines = []) {
  const colors = {
    success: "bg-emerald-900 border-emerald-700 text-emerald-100",
    error: "bg-rose-900 border-rose-700 text-rose-100",
    info: "bg-neutral-800 border-neutral-700 text-neutral-100",
  }[kind] || "bg-neutral-800 border-neutral-700 text-neutral-100";

  const card = h("div", { class: `min-w-[320px] max-w-md border rounded px-3 py-2 shadow-lg ${colors} animate-in` }, [
    h("div", { class: "font-medium text-sm" }, [title]),
    lines.length > 0
      ? h("pre", { class: "mt-1 text-xs font-mono whitespace-pre-wrap opacity-80 max-h-40 overflow-auto" },
          [lines.join("\n")])
      : null,
  ]);
  toastHost.appendChild(card);
  setTimeout(() => {
    card.style.opacity = "0";
    card.style.transition = "opacity 0.4s";
    setTimeout(() => card.remove(), 400);
  }, 6000);
}

function formatLogs(logs) {
  if (!Array.isArray(logs)) return [];
  return logs.map((l) => {
    const marker = { ok: "✓", warn: "!", error: "✗", info: " " }[l.level] || " ";
    return `${marker} ${l.message}`;
  });
}

async function runAction(actionPath, body, label) {
  const { status, data } = await postAction(actionPath, body);
  const logs = formatLogs(data?.logs);
  if (status >= 200 && status < 300 && data?.ok) {
    toast("success", label + " ✓", logs);
  } else {
    const msg = data?.error || `${status} error`;
    toast("error", `${label} failed`, [msg, ...logs]);
  }
  // Kick an immediate refresh so the UI reflects the new state.
  scheduleRefresh(true);
}

// ── rendering ──────────────────────────────────────────────────────────────
function renderWorktree(project, repo, wt) {
  const actions = h("div", { class: "flex items-center gap-1.5" }, [
    btn(wt.paneLive ? "test" : "test", {
      variant: "primary",
      title: "start test processes for this feature",
      onClick: () => runAction("/api/actions/test/start", {
        project: project.name, feature: wt.feature, repos: [repo.name],
      }, `test ${wt.feature}`),
    }),
    btn("MR?", {
      title: "fetch MR/PR status",
      onClick: async (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        button.textContent = "…";
        const { data } = await getJSON(
          `/api/mr/${encodeURIComponent(project.name)}/${encodeURIComponent(repo.name)}/${encodeURIComponent(wt.feature)}`,
        );
        button.disabled = false;
        button.textContent = "MR?";
        if (!data?.ok) {
          toast("info", `${wt.feature}: no MR`, [data?.error || "unknown"]);
          return;
        }
        const s = data.status || {};
        const url = s.url || "";
        const lines = [
          `provider: ${data.provider}`,
          `state: ${s.state}`,
          s.ciPipelineStatus ? `CI: ${s.ciPipelineStatus}` : null,
          url ? `url: ${url}` : null,
        ].filter(Boolean);
        if (url) {
          const go = confirm(`${wt.feature}\nstate: ${s.state}\n\nopen ${url}?`);
          if (go) window.open(url, "_blank");
        } else {
          toast("info", `${wt.feature}: MR`, lines);
        }
      },
    }),
    btn("cleanup", {
      variant: "danger",
      title: "remove worktree + close pane + delete branch if safe",
      onClick: () => {
        if (!confirm(`cleanup ${repo.name}/${wt.feature}? (worktree + branch)`)) return;
        runAction("/api/actions/cleanup", {
          project: project.name, feature: wt.feature, repo: repo.name,
        }, `cleanup ${repo.name}/${wt.feature}`);
      },
    }),
  ]);

  return h("div", { class: "flex items-center justify-between px-3 py-2 bg-neutral-900/50 rounded border border-neutral-800 hover:border-neutral-700 transition" }, [
    h("div", { class: "flex items-center gap-3 min-w-0" }, [
      wt.paneLive ? dotPill("agent running", "green") : dotPill("idle", "neutral"),
      h("span", { class: "font-medium" }, [wt.feature]),
      h("span", { class: "text-xs text-neutral-500 font-mono truncate" }, [wt.branch || ""]),
    ]),
    actions,
  ]);
}

function renderStack(project, repo, stack) {
  const color = stack.running ? "green" : "neutral";
  const text = stack.running ? "running" : "stopped";
  const actions = h("div", { class: "flex items-center gap-1.5" }, [
    btn(stack.running ? "stop" : "up", {
      variant: stack.running ? "default" : "success",
      onClick: () => runAction(
        stack.running ? "/api/actions/env/down" : "/api/actions/env/up",
        { project: project.name, feature: stack.feature, repo: repo.name },
        `${stack.running ? "down" : "up"} ${stack.feature}`,
      ),
    }),
    btn("recreate", {
      title: "down -v + up (resets volumes)",
      onClick: () => {
        if (!confirm(`recreate ${stack.feature}? this drops its volumes.`)) return;
        runAction("/api/actions/env/recreate", {
          project: project.name, feature: stack.feature, repo: repo.name,
        }, `recreate ${stack.feature}`);
      },
    }),
    btn("cleanup", {
      variant: "danger",
      title: "down -v (full teardown incl. volumes)",
      onClick: () => {
        if (!confirm(`cleanup ${stack.feature}? drops containers AND volumes.`)) return;
        runAction("/api/actions/cleanup", {
          project: project.name, feature: stack.feature, repo: repo.name,
        }, `cleanup ${repo.name}/${stack.feature}`);
      },
    }),
  ]);

  return h("div", { class: "flex items-center justify-between px-3 py-2 bg-neutral-900/50 rounded border border-neutral-800" }, [
    h("div", { class: "flex items-center gap-3 min-w-0" }, [
      dotPill(text, color),
      h("span", { class: "font-medium" }, [stack.feature]),
      stack.services.length > 0
        ? h("span", { class: "text-xs text-neutral-500" }, [
            `${stack.services.length} service${stack.services.length === 1 ? "" : "s"}`,
          ])
        : null,
      h("span", { class: "text-xs text-neutral-600" }, [stack.status]),
    ]),
    actions,
  ]);
}

function renderRepo(project, repo) {
  const header = h("div", { class: "flex items-center justify-between" }, [
    h("div", { class: "flex items-center gap-3" }, [
      h("span", { class: "font-mono text-sm font-medium" }, [repo.name]),
      pill(repo.type, repo.type === "compose" ? "blue" : "neutral"),
      repo.baseBranch
        ? h("span", { class: "text-xs text-neutral-500" }, [`base: ${repo.baseBranch}`])
        : null,
    ]),
    h("span", { class: "text-xs text-neutral-600 font-mono truncate max-w-md" }, [repo.path]),
  ]);

  const items = [];
  if (repo.type === "git") {
    if (repo.worktrees.length === 0) {
      items.push(h("div", { class: "px-3 py-2 text-xs text-neutral-600 italic" }, ["(no worktrees)"]));
    } else {
      for (const wt of repo.worktrees) items.push(renderWorktree(project, repo, wt));
    }
  } else {
    if (repo.stacks.length === 0) {
      items.push(h("div", { class: "px-3 py-2 text-xs text-neutral-600 italic" }, ["(no active stacks)"]));
    } else {
      for (const s of repo.stacks) items.push(renderStack(project, repo, s));
    }
  }

  return h("div", { class: "space-y-2" }, [
    header,
    h("div", { class: "space-y-1 ml-4" }, items),
  ]);
}

function complexityBadge(level) {
  const map = {
    HIGH: { class: "bg-rose-900/60 text-rose-200 ring-rose-700", label: "HIGH" },
    medium: { class: "bg-yellow-900/60 text-yellow-200 ring-yellow-700", label: "med" },
    low: { class: "bg-emerald-900/60 text-emerald-200 ring-emerald-700", label: "low" },
  };
  const c = map[level] || map.low;
  return h("span", { class: `inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded ring-1 ${c.class}` }, [c.label]);
}

function renderPulse(pulse) {
  if (!pulse || !pulse.features || pulse.features.length === 0) {
    return h("div", { class: "text-xs text-neutral-600 italic" }, ["no active features for pulse analysis"]);
  }

  // Per-feature summary cards.
  const cards = h(
    "div",
    { class: "grid gap-2 mb-3", style: `grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));` },
    pulse.features.map((f) =>
      h("div", { class: "bg-neutral-950 border border-neutral-800 rounded p-2.5" }, [
        h("div", { class: "flex items-center justify-between mb-1" }, [
          h("span", { class: "font-mono text-sm font-medium" }, [f.name]),
          complexityBadge(f.complexity),
        ]),
        h("div", { class: "text-[11px] text-neutral-500 space-y-0.5" }, [
          h("div", {}, [`${f.totalFiles} files · ${f.totalCommits} commit${f.totalCommits === 1 ? "" : "s"} ahead`]),
          h("div", {}, [`${f.overlapCount} overlap${f.overlapCount === 1 ? "" : "s"} with other features`]),
          h("div", { class: "text-neutral-600 truncate" }, [
            f.repos.map((r) => (r.dirty ? `${r.name}*` : r.name)).join(", "),
          ]),
        ]),
      ]),
    ),
  );

  // Overlap list. Per-row: severity dot, [repo] file path, list of features touching it.
  let overlapBlock;
  if (pulse.overlaps.length === 0) {
    overlapBlock = h("div", { class: "text-xs text-emerald-400 px-2 py-1.5" }, [
      "✓ no overlap — features touch disjoint file sets",
    ]);
  } else {
    const rows = pulse.overlaps.slice(0, 40).map((o) => {
      const sev =
        o.features.length >= 3
          ? h("span", { class: "text-rose-400" }, ["🔥"])
          : h("span", { class: "text-yellow-400" }, ["⚠"]);
      return h("div", { class: "flex items-start gap-2 py-1 text-xs border-b border-neutral-900/60 last:border-0" }, [
        h("span", { class: "shrink-0" }, [sev]),
        h("div", { class: "flex-1 min-w-0" }, [
          h("div", { class: "flex items-center gap-2" }, [
            h("span", { class: "text-neutral-500 text-[10px] uppercase tracking-wider" }, [o.repo]),
            h("span", { class: "font-mono text-neutral-300 truncate" }, [o.file]),
          ]),
          h(
            "div",
            { class: "flex flex-wrap gap-1 mt-0.5" },
            o.features.map((f) =>
              h("span", { class: "text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400" }, [f]),
            ),
          ),
        ]),
      ]);
    });
    overlapBlock = h(
      "div",
      { class: "bg-neutral-950 border border-neutral-800 rounded px-3 py-2 max-h-[400px] overflow-y-auto" },
      [
        h("div", { class: "text-[10px] text-neutral-500 uppercase tracking-wider mb-1" }, [
          `${pulse.overlaps.length} overlap${pulse.overlaps.length === 1 ? "" : "s"}`,
        ]),
        ...rows,
        pulse.overlaps.length > 40
          ? h("div", { class: "text-[10px] text-neutral-600 mt-1" }, [
              `... ${pulse.overlaps.length - 40} more`,
            ])
          : null,
      ],
    );
  }

  // Suggested merge order.
  const orderItems = pulse.suggestedOrder.map((name, i) => {
    const f = pulse.features.find((x) => x.name === name);
    const reason =
      !f || f.overlapCount === 0
        ? "isolated"
        : f.overlapCount < 3
          ? `${f.overlapCount} overlap${f.overlapCount === 1 ? "" : "s"}`
          : `${f.overlapCount} overlaps · high cost`;
    return h("li", { class: "flex items-center gap-2 text-xs py-0.5" }, [
      h("span", { class: "text-neutral-600 w-4 text-right" }, [`${i + 1}.`]),
      h("span", { class: "font-mono text-neutral-200" }, [name]),
      h("span", { class: "text-neutral-500" }, [`(${reason})`]),
    ]);
  });

  return h("div", { class: "space-y-3" }, [
    cards,
    h("div", { class: "grid grid-cols-1 lg:grid-cols-3 gap-3" }, [
      h("div", { class: "lg:col-span-2 space-y-1" }, [
        h("div", { class: "text-[10px] text-neutral-500 uppercase tracking-wider px-1" }, [
          "conflict surface (file × feature)",
        ]),
        overlapBlock,
      ]),
      h("div", { class: "space-y-1" }, [
        h("div", { class: "text-[10px] text-neutral-500 uppercase tracking-wider px-1" }, [
          "suggested merge order",
        ]),
        h("ol", { class: "bg-neutral-950 border border-neutral-800 rounded px-3 py-2 space-y-0" }, orderItems),
      ]),
    ]),
  ]);
}

function renderProject(project) {
  const activeCount = project.repos.reduce((s, r) => s + r.worktrees.length, 0);
  const runningStacks = project.repos.flatMap((r) => r.stacks).filter((s) => s.running).length;

  const pulseSection = project.pulse
    ? h("details", { class: "border-t border-neutral-800 pt-3 mt-2", open: "" }, [
        h("summary", { class: "cursor-pointer text-xs text-neutral-400 hover:text-neutral-200 mb-2 select-none" }, [
          `🌡 pulse — conflict surface across active features (vs origin/${project.pulse.base})`,
        ]),
        renderPulse(project.pulse),
      ])
    : null;

  return h("section", { class: "bg-neutral-900 border border-neutral-800 rounded-lg p-5" }, [
    h("div", { class: "flex items-center justify-between mb-4" }, [
      h("div", { class: "flex items-center gap-3" }, [
        h("h2", { class: "text-lg font-semibold" }, [project.name]),
        project.sessionRunning ? pill("tmux session live", "green") : pill("session off", "neutral"),
      ]),
      h("div", { class: "flex items-center gap-2 text-xs text-neutral-500" }, [
        h("span", {}, [`${project.repos.length} repos`]),
        h("span", {}, ["·"]),
        h("span", {}, [`${activeCount} worktrees`]),
        runningStacks > 0 ? h("span", { class: "text-emerald-400" }, [`· ${runningStacks} stacks up`]) : null,
      ]),
    ]),
    h("div", { class: "space-y-4" }, project.repos.map((r) => renderRepo(project, r))),
    pulseSection,
  ]);
}

function render(state) {
  root.innerHTML = "";

  if (state.error) {
    root.appendChild(h("div", { class: "bg-rose-900/30 border border-rose-800 text-rose-200 rounded p-4" }, [
      "error: " + state.error,
    ]));
    return;
  }

  if (!state.projects || state.projects.length === 0) {
    root.appendChild(h("p", { class: "text-neutral-500" }, ["no projects configured. edit ~/.config/banyan/config.yaml"]));
    return;
  }

  for (const project of state.projects) {
    root.appendChild(renderProject(project));
  }

  const time = new Date(state.generatedAt).toLocaleTimeString();
  lastRefreshEl.textContent = `refreshed ${time}`;
}

// ── polling loop ───────────────────────────────────────────────────────────
let pollTimer = null;
let consecutiveErrors = 0;

async function fetchPulse(projectName) {
  try {
    const r = await fetch(`/api/pulse/${encodeURIComponent(projectName)}`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function loop() {
  const state = await fetchState();
  if (state.error) {
    consecutiveErrors++;
    if (consecutiveErrors > 5) {
      statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-400 inline-block"></span><span>disconnected</span>`;
    }
  } else {
    consecutiveErrors = 0;
    statusEl.innerHTML = `<span class="pulse-dot bg-emerald-400"></span><span>live</span>`;

    // Pulse data per project — best-effort, parallel. Slower than /api/state
    // (it shells out to git diff per worktree) so we fan out instead of
    // serialising. Failures don't break the rest of the dashboard.
    if (Array.isArray(state.projects)) {
      await Promise.all(
        state.projects.map(async (p) => {
          p.pulse = await fetchPulse(p.name);
        }),
      );
    }
  }
  render(state);
  pollTimer = setTimeout(loop, REFRESH_MS);
}

function scheduleRefresh(immediate = false) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(loop, immediate ? 200 : REFRESH_MS);
}

loop();
