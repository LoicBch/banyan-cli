const REFRESH_MS = 2000;

const root = document.getElementById("root");
const statusEl = document.getElementById("status");
const lastRefreshEl = document.getElementById("last-refresh");
const toastHost = document.getElementById("toast-host");
const projectSelectorEl = document.getElementById("project-selector");

// ── current-project state ─────────────────────────────────────────────────
// All tabs are scoped to one project at a time. The user picks via the
// header dropdown; the choice persists in localStorage so reloads stay
// in context.
const PROJECT_KEY = "banyan.dashboard.currentProject";
let currentProject = null;
function readPersistedProject() {
  try { return localStorage.getItem(PROJECT_KEY); } catch { return null; }
}
function persistProject(name) {
  try {
    if (name) localStorage.setItem(PROJECT_KEY, name);
    else localStorage.removeItem(PROJECT_KEY);
  } catch { /* ignore */ }
}
function setCurrentProject(name, opts = {}) {
  if (currentProject === name) return;
  currentProject = name;
  persistProject(name);
  if (projectSelectorEl) projectSelectorEl.value = name ?? "";
  // Mirror the choice to the Discord RPC service so the user's profile
  // tracks whichever project they're currently focused on in the dashboard.
  pushDiscordFocus(name);
  if (!opts.skipRefresh) {
    // Re-render the active tab so it shows the right scope.
    setTab(currentTab);
    scheduleRefresh(true);
  }
}

function pushDiscordFocus(name) {
  fetch("/api/discord/focus", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: name ?? null }),
  }).catch(() => { /* Discord RPC is optional; failures are non-fatal */ });
}

projectSelectorEl?.addEventListener("change", (e) => {
  setCurrentProject(e.target.value);
});

/** Sync the dropdown options against the freshest project list and pick a
 *  default if currentProject is unset / no longer exists. */
function syncProjectSelector(projectNames) {
  if (!projectSelectorEl) return;
  if (!projectNames || projectNames.length === 0) {
    projectSelectorEl.classList.add("hidden");
    setCurrentProject(null, { skipRefresh: true });
    return;
  }
  // Build/refresh options.
  const desired = projectNames.join("|");
  if (projectSelectorEl.dataset.signature !== desired) {
    projectSelectorEl.innerHTML = "";
    for (const n of projectNames) {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      projectSelectorEl.appendChild(opt);
    }
    projectSelectorEl.dataset.signature = desired;
  }
  // Hide when only one project (no choice to make).
  projectSelectorEl.classList.toggle("hidden", projectNames.length <= 1);
  // Pick a default if needed.
  if (!currentProject || !projectNames.includes(currentProject)) {
    const saved = readPersistedProject();
    const next = projectNames.includes(saved) ? saved : projectNames[0];
    setCurrentProject(next, { skipRefresh: true });
  } else {
    projectSelectorEl.value = currentProject;
  }
}

// ── auth bootstrap ────────────────────────────────────────────────────────
// When the server runs with `--remote`, every API call needs a Bearer token.
// We accept the token from the URL hash on first load (the QR code includes
// `#token=...`), persist it in localStorage, then attach it to every fetch.
// On localhost-only mode the token is empty and no headers are added.
const TOKEN_KEY = "banyan.dashboard.token";
function readTokenFromHash() {
  const m = /[#&]token=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  return m ? m[1] : null;
}
const tokenFromHash = readTokenFromHash();
if (tokenFromHash) {
  try { localStorage.setItem(TOKEN_KEY, tokenFromHash); } catch { /* ignore */ }
  // Strip token from the visible URL — keep the hash for other anchors if any.
  const cleaned = window.location.hash.replace(/[#&]token=[^&]+/, "");
  history.replaceState(null, "", window.location.pathname + window.location.search + cleaned);
}
function getAuthToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

// Wrap fetch so every same-origin call gets `Authorization: Bearer <token>`
// when a token is set. EventSource (none used today) would need a query param;
// the server already accepts `?token=…` as a fallback.
const _origFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const token = getAuthToken();
  if (!token) return _origFetch(input, init);
  const headers = new Headers(init.headers || (typeof input === "object" && input.headers) || {});
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return _origFetch(input, { ...init, headers });
};

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

/** Shorten an absolute path to use `~` for the home dir. Keeps paths
 *  scannable in the repo list. */
function shortenHomePath(p) {
  const home = (typeof window !== "undefined" && window.__BANYAN_HOME__) || "";
  // Fallback: do best-effort string replace on the typical macOS home.
  if (home && p.startsWith(home + "/")) return "~" + p.slice(home.length);
  const m = /^\/(?:Users|home)\/[^/]+/.exec(p);
  if (m) return "~" + p.slice(m[0].length);
  return p;
}

function renderRepo(project, repo, opts = {}) {
  // When the project header already shows the shared base branch, the
  // per-repo `base: develop` is redundant noise. Caller sets `showBase: false`.
  const showBase = opts.showBase !== false && !!repo.baseBranch;

  const header = h("div", { class: "flex items-center justify-between gap-3" }, [
    h("div", { class: "flex items-center gap-3 min-w-0" }, [
      h("span", { class: "font-mono text-sm font-medium" }, [repo.name]),
      pill(repo.type, repo.type === "compose" ? "blue" : "neutral"),
      showBase
        ? h("span", { class: "text-xs text-neutral-500" }, [`base: ${repo.baseBranch}`])
        : null,
    ]),
    h("span", { class: "text-xs text-neutral-600 font-mono truncate max-w-md" }, [shortenHomePath(repo.path)]),
  ]);

  // For empty repos in an empty project, the header alone says everything —
  // skip the "(no worktrees)" / "(no active stacks)" line that was repeated
  // for every repo and added vertical noise.
  const items = [];
  if (repo.type === "git") {
    for (const wt of repo.worktrees) items.push(renderWorktree(project, repo, wt));
  } else {
    for (const s of repo.stacks) items.push(renderStack(project, repo, s));
  }

  return h("div", { class: items.length > 0 ? "space-y-2" : "" }, [
    header,
    items.length > 0
      ? h("div", { class: "space-y-1 ml-4" }, items)
      : null,
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

  const overlapCount = (pulse.overlaps || []).length;

  // Single-line headline: just the number. Green when clean, amber when
  // there's something to look at.
  const headline = overlapCount === 0
    ? h("div", { class: "flex items-center gap-2 text-sm" }, [
        h("span", { class: "text-emerald-400 text-base" }, ["✓"]),
        h("span", { class: "text-emerald-300 font-medium" }, ["no overlapping files"]),
        h("span", { class: "text-neutral-500 text-xs" }, [
          `across ${pulse.features.length} active feature${pulse.features.length === 1 ? "" : "s"}`,
        ]),
      ])
    : h("div", { class: "flex items-center gap-2 text-sm" }, [
        h("span", { class: "text-amber-400 font-semibold" }, [String(overlapCount)]),
        h("span", { class: "text-neutral-300" }, [
          `file${overlapCount === 1 ? "" : "s"} touched by multiple features`,
        ]),
      ]);

  // Compact details (only when there ARE overlaps): one line per file, no
  // emojis, no pills, no [REPO] uppercase header. Just "repo/file — feat,feat".
  const details = overlapCount === 0
    ? null
    : h("details", { class: "mt-2", "data-key": `pulse-overlaps:${pulse.project}` }, [
        h("summary", { class: "cursor-pointer text-xs text-neutral-500 hover:text-neutral-300 select-none" }, [
          `see ${overlapCount} overlapping file${overlapCount === 1 ? "" : "s"}`,
        ]),
        h("div", { class: "mt-1 bg-neutral-950 border border-neutral-800 rounded p-2 max-h-64 overflow-y-auto space-y-0.5" },
          pulse.overlaps.slice(0, 60).map((o) =>
            h("div", { class: "text-xs flex items-baseline gap-2" }, [
              h("span", { class: "font-mono text-neutral-300 truncate min-w-0 flex-1" }, [`${o.repo}/${o.file}`]),
              h("span", { class: "text-neutral-500 shrink-0" }, [o.features.join(", ")]),
            ]),
          ).concat(
            pulse.overlaps.length > 60
              ? [h("div", { class: "text-[10px] text-neutral-600" }, [`+${pulse.overlaps.length - 60} more`])]
              : [],
          ),
        ),
      ]);

  // Semantic merge order — on-demand only.
  const semanticPanel = renderSemanticOrderPanel(pulse);

  return h("div", { class: "space-y-3" }, [
    h("div", {}, [headline, details]),
    h("div", { class: "border-t border-neutral-800 pt-3" }, [
      h("div", { class: "text-[10px] text-neutral-500 uppercase tracking-wider mb-1" }, [
        "merge order — semantic",
      ]),
      semanticPanel,
    ]),
  ]);
}

/** Cache of Claude responses keyed by `<project>::<pulse-fingerprint>` so
 *  that re-opening / refreshing doesn't re-bill the user. Cleared per session. */
const semanticOrderCache = new Map();

/** Cheap fingerprint of the pulse to detect "anything meaningful changed":
 *  feature names + each feature's overlap+file count. Worktree internals
 *  matter only insofar as they affect what we'd reason about. */
function pulseFingerprint(pulse) {
  return (pulse.features || [])
    .map((f) => `${f.name}:${f.totalFiles}:${f.overlapCount}:${f.totalCommits}`)
    .sort()
    .join("|");
}

function renderSemanticOrderPanel(pulse) {
  if (!pulse.features || pulse.features.length < 2) {
    return h(
      "div",
      { class: "bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-xs text-neutral-500" },
      ["at least 2 active features needed to compute a merge order"],
    );
  }

  const project = pulse.project;
  const fp = pulseFingerprint(pulse);
  const cached = semanticOrderCache.get(`${project}::${fp}`);

  const wrap = h("div", { class: "bg-neutral-950 border border-neutral-800 rounded p-2 space-y-2" }, []);

  const renderBody = (state) => {
    wrap.innerHTML = "";
    if (state.kind === "idle") {
      wrap.appendChild(h("div", { class: "text-xs text-neutral-500" }, [
        "Click to ask Claude to reason about the optimal merge order based on the pulse, reports, and recent commits. Cached per-session.",
      ]));
      wrap.appendChild(btn("▶ compute (Claude)", {
        variant: "primary",
        onClick: () => askSemanticOrder(project, pulse, renderBody),
      }));
    } else if (state.kind === "streaming") {
      wrap.appendChild(h("div", { class: "text-xs text-sky-300 flex items-center gap-2" }, [
        h("span", { class: "pulse-dot bg-sky-400" }),
        "Claude is reasoning…",
      ]));
      wrap.appendChild(h("pre", {
        class: "whitespace-pre-wrap text-xs font-sans text-neutral-300 max-h-64 overflow-auto",
      }, [state.answer || "…"]));
    } else if (state.kind === "done") {
      wrap.appendChild(h("pre", {
        class: "whitespace-pre-wrap text-xs font-sans text-neutral-200 max-h-64 overflow-auto",
      }, [state.answer]));
      wrap.appendChild(h("div", { class: "flex items-center justify-between text-[10px] text-neutral-500" }, [
        h("span", {}, [`computed ${state.elapsed}s ago · cached`]),
        btn("refresh", {
          onClick: () => {
            semanticOrderCache.delete(`${project}::${fp}`);
            renderBody({ kind: "idle" });
          },
        }),
      ]));
    } else if (state.kind === "error") {
      wrap.appendChild(h("div", { class: "text-xs text-rose-300" }, [state.error]));
      wrap.appendChild(btn("retry", {
        onClick: () => askSemanticOrder(project, pulse, renderBody),
      }));
    }
  };

  if (cached) {
    const elapsed = Math.round((Date.now() - cached.ts) / 1000);
    renderBody({ kind: "done", answer: cached.answer, elapsed });
  } else {
    renderBody({ kind: "idle" });
  }

  return wrap;
}

async function askSemanticOrder(project, pulse, setState) {
  // Build a focused question. We embed the pulse summary so Claude has the
  // numeric signal as a starting point but can reason beyond it.
  const featureLines = pulse.features
    .map((f) => `- ${f.name} (${f.repos.map((r) => r.name).join("+")}): ${f.totalFiles} files, ${f.overlapCount} overlaps, complexity=${f.complexity}`)
    .join("\n");
  const overlapLines = pulse.overlaps
    ? pulse.overlaps.slice(0, 20).map((o) => `  ${o.repo}: ${o.file} — touched by [${o.features.join(", ")}]`).join("\n")
    : "(none)";
  const question =
    `Given the following active features in project '${project}', what is the optimal merge order ` +
    `and why? Reason beyond the file-overlap count — consider semantic risks like renames, ` +
    `API signature changes, shared invariants. Be concise: numbered list of features in the order ` +
    `you'd merge, with a 1-sentence reason per feature.\n\n` +
    `Active features:\n${featureLines}\n\n` +
    `File overlaps detected:\n${overlapLines}`;

  setState({ kind: "streaming", answer: "" });

  try {
    const r = await fetch(`/api/ask/${encodeURIComponent(project)}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ question, includeTranscripts: false, days: 14 }),
    });
    if (!r.ok || !r.body) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${r.status}`);
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = "message";
        let dataLine = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataLine += line.slice(6);
        }
        if (!dataLine) continue;
        const data = JSON.parse(dataLine);
        if (event === "chunk") {
          answer += data.text;
          setState({ kind: "streaming", answer });
        } else if (event === "done") {
          const fp = pulseFingerprint(pulse);
          semanticOrderCache.set(`${project}::${fp}`, { answer, ts: Date.now() });
          setState({ kind: "done", answer, elapsed: 0 });
          return;
        } else if (event === "error") {
          throw new Error(data.message || "stream error");
        }
      }
    }
  } catch (err) {
    setState({ kind: "error", error: err.message });
  }
}

function statusBadge(status) {
  switch (status) {
    case "done":
      return pill("done", "green");
    case "blocked":
      return pill("blocked", "red");
    case "needs_review":
      return pill("needs review", "yellow");
    default:
      return pill(status, "neutral");
  }
}

function renderReportList(label, items) {
  if (!items || items.length === 0) return null;
  return h("div", { class: "mt-2" }, [
    h("div", { class: "text-xs text-neutral-500 mb-1" }, [label]),
    h(
      "ul",
      { class: "list-disc list-inside text-sm text-neutral-300 space-y-0.5" },
      items.map((s) => h("li", {}, [s])),
    ),
  ]);
}

function renderReport(r) {
  const ts = new Date(r.ts).toLocaleString();
  return h("details", { class: "border border-neutral-800 rounded p-3 bg-neutral-950" }, [
    h("summary", { class: "cursor-pointer text-sm flex items-center gap-2 select-none" }, [
      statusBadge(r.status),
      h("span", { class: "font-medium" }, [r.feature]),
      h("span", { class: "text-neutral-500 text-xs ml-auto" }, [ts]),
    ]),
    h("div", { class: "mt-3 space-y-1" }, [
      h("p", { class: "text-sm text-neutral-200 whitespace-pre-wrap" }, [r.summary]),
      h("div", { class: "mt-2" }, [
        h("div", { class: "text-xs text-neutral-500 mb-1" }, ["how to test"]),
        h("pre", { class: "text-xs font-mono whitespace-pre-wrap text-neutral-300 bg-neutral-900 rounded p-2" }, [
          r.testInstructions,
        ]),
      ]),
      renderReportList("hesitations", r.hesitations),
      renderReportList("open questions", r.openQuestions),
      renderReportList("risks", r.risks),
      r.filesChanged && r.filesChanged.length > 0
        ? h("div", { class: "mt-2" }, [
            h("div", { class: "text-xs text-neutral-500 mb-1" }, [`files (${r.filesChanged.length})`]),
            h("pre", { class: "text-xs font-mono whitespace-pre-wrap text-neutral-300" }, [
              r.filesChanged.join("\n"),
            ]),
          ])
        : null,
      r.commits && r.commits.length > 0
        ? h("div", { class: "mt-2" }, [
            h("div", { class: "text-xs text-neutral-500 mb-1" }, ["commits"]),
            h(
              "ul",
              { class: "text-xs font-mono text-neutral-300 space-y-0.5" },
              r.commits.map((c) => h("li", {}, [`${c.sha.slice(0, 8)}  ${c.message}`])),
            ),
          ])
        : null,
    ]),
  ]);
}

// Per-feature drill-down folds the approvals/todos/reports detail into
// the pipeline row itself, so the project view stays workflow-first.
// renderReport / renderReportList stay defined above for reuse there.

// ── pipeline ───────────────────────────────────────────────────────────────
const PIPELINE_STAGES = ["created", "planning", "approval", "working", "reported", "merged"];
const STAGE_LABELS = {
  created:  "Created",
  planning: "Planning",
  approval: "Approval",
  working:  "Working",
  reported: "Reported",
  merged:   "Merged",
};
const FLAG_LABELS = {
  rejected:     { text: "rejected — agent revising", color: "red" },
  blocked:      { text: "blocked",                   color: "red" },
  needs_review: { text: "needs review",              color: "yellow" },
};

function pipelineDot(state, label) {
  // state: "passed" | "current" | "pending"
  const cls = {
    passed:  "bg-emerald-500",
    current: "bg-sky-400 ring-2 ring-sky-300/40",
    pending: "bg-neutral-700",
  }[state];
  const textCls = state === "pending" ? "text-neutral-600" : "text-neutral-300";
  return h("div", { class: "flex flex-col items-center gap-1 flex-1 min-w-0" }, [
    h("div", { class: `w-3 h-3 rounded-full ${cls}` }),
    h("span", { class: `text-[10px] uppercase tracking-wider ${textCls} truncate` }, [label]),
  ]);
}

function pipelineConnector(state) {
  const cls = state === "passed" ? "bg-emerald-500" : "bg-neutral-700";
  return h("div", { class: `flex-shrink-0 h-px w-6 ${cls} self-start mt-[5px]` });
}

function renderPipelineBar(stageIndex) {
  const children = [];
  PIPELINE_STAGES.forEach((stage, i) => {
    const state =
      i < stageIndex ? "passed" : i === stageIndex ? "current" : "pending";
    children.push(pipelineDot(state, STAGE_LABELS[stage]));
    if (i < PIPELINE_STAGES.length - 1) {
      const connState = i < stageIndex ? "passed" : "pending";
      children.push(pipelineConnector(connState));
    }
  });
  return h("div", { class: "flex items-start gap-1 w-full" }, children);
}

function approveButtons(project, entry, scope) {
  const label = scope === "plan" ? "plan" : "report";
  return [
    btn(`approve ${label}`, {
      variant: "success",
      onClick: () => runAction("/api/actions/approve", {
        project: project.name,
        feature: entry.feature,
        scope,
      }, `approve ${label} ${entry.feature}`),
    }),
    btn("reject", {
      variant: "danger",
      onClick: () => {
        const note = window.prompt(`reject reason for ${entry.feature}'s ${label}? (optional)`);
        if (note === null) return;
        runAction("/api/actions/approve", {
          project: project.name,
          feature: entry.feature,
          scope,
          reject: true,
          note: note || undefined,
        }, `reject ${label} ${entry.feature}`);
      },
    }),
  ];
}

/** Resolve which TODO entry (if any) belongs to this feature, from the
 *  project-level todos list the dashboard already loads. */
function findTodo(project, feature) {
  if (!project.todos) return null;
  return project.todos.find((t) => t.feature === feature) ?? null;
}

/** Resolve the full report list for this feature (from the project-level
 *  reports the dashboard already loads). */
function findReports(project, feature) {
  if (!project.reports) return [];
  return project.reports.filter((r) => r.feature === feature);
}

/** One-line short stage label for the collapsed feature row. */
function stageLabel(entry) {
  if (entry.flag) return FLAG_LABELS[entry.flag].text;
  return STAGE_LABELS[entry.stage] ?? entry.stage;
}

/** Pill colour for the stage. Off-pipeline flags override the stage. */
function stagePill(entry) {
  if (entry.flag) return pill(FLAG_LABELS[entry.flag].text, FLAG_LABELS[entry.flag].color);
  switch (entry.stage) {
    case "merged":   return pill("merged", "neutral");
    case "reported": return pill("reported", "yellow");   // user action expected
    case "approval": return pill("plan pending", "yellow");
    case "working":  return pill("working", "blue");
    case "planning": return pill("planning", "blue");
    case "created":  return pill("created", "neutral");
    default:         return pill(entry.stage, "neutral");
  }
}

/** What's the user's next action? Used as a hint on the collapsed row. */
function nextAction(entry) {
  if (entry.approval?.status === "pending") return "→ approve plan";
  if (entry.reportApproval?.status === "pending") return "→ review report";
  if (entry.flag === "rejected") return "agent revising…";
  if (entry.flag === "blocked") return "→ unblock";
  if (entry.stage === "reported") return "→ test + merge";
  return null;
}

function renderTodoChecklist(todo, opts = {}) {
  if (!todo || todo.items.length === 0) return null;
  const total = todo.items.length;
  const done = todo.items.filter((it) => it.done).length;

  // Compressed view by default: show the next 3 unchecked items + a count
  // of the rest. Full list behind a toggle. Avoids 20-line TODO walls on
  // long features.
  const upcoming = todo.items.filter((it) => !it.done);
  const PREVIEW = 3;
  const previewItems = upcoming.slice(0, PREVIEW);
  const moreCount = Math.max(0, upcoming.length - PREVIEW);

  const renderItem = (it) =>
    h("li", { class: "flex items-start gap-2" }, [
      h("span", {
        class: `inline-block w-4 text-center ${it.done ? "text-emerald-400" : "text-neutral-600"}`,
      }, [it.done ? "✓" : "·"]),
      h("span", { class: it.done ? "line-through text-neutral-500" : "text-neutral-200" }, [
        `${it.id}. ${it.text}`,
      ]),
    ]);

  return h("div", { class: "mt-3" }, [
    h("div", { class: "text-xs text-neutral-500 mb-1" }, [`TODO ${done}/${total}`]),
    h("ul", { class: "space-y-0.5 text-sm" }, previewItems.map(renderItem)),
    moreCount > 0
      ? h("details", { class: "mt-1", "data-key": `todo-full:${opts.scopeKey ?? ""}` }, [
          h("summary", { class: "cursor-pointer text-xs text-neutral-500 hover:text-neutral-300 select-none" }, [
            `+${moreCount} more${done > 0 ? ` (${done} done)` : ""}`,
          ]),
          h("ul", { class: "space-y-0.5 text-sm mt-1" },
            [...upcoming.slice(PREVIEW), ...todo.items.filter((it) => it.done)].map(renderItem),
          ),
        ])
      : (done > 0
          ? h("details", { class: "mt-1", "data-key": `todo-done:${opts.scopeKey ?? ""}` }, [
              h("summary", { class: "cursor-pointer text-xs text-neutral-500 hover:text-neutral-300 select-none" }, [
                `${done} done`,
              ]),
              h("ul", { class: "space-y-0.5 text-sm mt-1" },
                todo.items.filter((it) => it.done).map(renderItem),
              ),
            ])
          : null),
  ]);
}

function renderLatestReport(report, opts = {}) {
  if (!report) return null;
  const ts = new Date(report.ts).toLocaleString();

  // Heuristic: surface hesitations / openQuestions / risks **immediately**
  // when the status calls for human attention. Otherwise hide them behind a
  // "details" toggle so a clean `done` doesn't fill the screen.
  const needsAttention =
    report.status === "needs_review" || report.status === "blocked";
  const hasDetails =
    !!report.testInstructions ||
    (report.hesitations?.length ?? 0) > 0 ||
    (report.openQuestions?.length ?? 0) > 0 ||
    (report.risks?.length ?? 0) > 0;

  const detailsBody = h("div", { class: "mt-2 space-y-2" }, [
    report.testInstructions
      ? h("div", {}, [
          h("div", { class: "text-xs text-neutral-500 mb-0.5" }, ["how to test"]),
          h("pre", { class: "text-xs font-mono whitespace-pre-wrap text-neutral-300 bg-neutral-950 rounded p-2" }, [
            report.testInstructions,
          ]),
        ])
      : null,
    renderReportList("hesitations", report.hesitations),
    renderReportList("open questions", report.openQuestions),
    renderReportList("risks", report.risks),
  ]);

  return h("div", { class: "mt-3 border border-neutral-800 rounded p-2 bg-neutral-900/50" }, [
    h("div", { class: "flex items-center gap-2 mb-1" }, [
      statusBadge(report.status),
      h("span", { class: "text-xs text-neutral-500" }, [ts]),
    ]),
    h("p", { class: "text-sm text-neutral-200 whitespace-pre-wrap" }, [report.summary]),
    hasDetails
      ? (needsAttention
          // Auto-open when the report wants attention.
          ? detailsBody
          : h("details", { class: "mt-1", "data-key": `report-details:${opts.scopeKey ?? ""}` }, [
              h("summary", { class: "cursor-pointer text-xs text-neutral-500 hover:text-neutral-300 select-none" }, [
                "details (test plan, hesitations, risks)",
              ]),
              detailsBody,
            ]))
      : null,
  ]);
}

/**
 * Feature-level action toolbar. These operate across every repo of the
 * feature — equivalent to the CLI `bn <project> <action> <feature>`. They
 * are the primary actions for the dashboard's feature-first mental model.
 */
function renderFeatureActions(project, entry) {
  const F = entry.feature;
  const has = entry.repos.length > 0;
  if (!has) return null;
  return h("div", { class: "flex flex-wrap items-center gap-1.5 mt-1" }, [
    btn("test", {
      variant: "primary",
      title: "start test processes for every repo + stack of this feature",
      onClick: () => runAction(
        "/api/actions/test/start",
        { project: project.name, feature: F },
        `test ${F}`,
      ),
    }),
    btn("rebase", {
      title: "rebase every worktree of this feature on origin/<base>",
      onClick: () => runAction(
        "/api/actions/rebase",
        { project: project.name, feature: F },
        `rebase ${F}`,
      ),
    }),
    btn("merge", {
      variant: "success",
      title: "push + create MR/PR + merge for every repo (auto-resolve conflicts)",
      onClick: () => {
        if (!confirm(`merge ${F} on every repo (PR/MR flow, squash + remove source branch)?`)) return;
        runAction(
          "/api/actions/merge",
          { project: project.name, feature: F },
          `merge ${F}`,
        );
      },
    }),
    btn("cleanup", {
      variant: "danger",
      title: "remove worktrees + delete branches (safe) + tear down stacks",
      onClick: () => {
        if (!confirm(`cleanup ${F} on every repo? (worktrees + branches + stacks with volumes)`)) return;
        runAction(
          "/api/actions/cleanup",
          { project: project.name, feature: F },
          `cleanup ${F}`,
        );
      },
    }),
  ]);
}

/**
 * Compact per-repo status table inside a feature card. Replaces the
 * standalone "repos" section's nested wt/stack rows for the active-feature
 * case — the user thinks feature-first, the UI follows.
 *
 * Each row shows: repo name + type pill + branch (git) / stack state
 * (compose) + small action icons. The actions reuse the existing per-repo
 * endpoints (env up/down/recreate, single-repo cleanup, MR fetch) — they
 * are the escape hatch for "only this stack, not the whole feature".
 */
function renderFeatureReposBar(project, entry) {
  const F = entry.feature;
  const rows = [];

  for (const repo of project.repos) {
    if (repo.type === "git") {
      const wt = (repo.worktrees || []).find((w) => w.feature === F);
      if (!wt) continue;
      rows.push(renderFeatureRepoGitRow(project, repo, wt));
    } else {
      // compose
      const stack = (repo.stacks || []).find((s) => s.feature === F);
      if (!stack) continue;
      rows.push(renderFeatureRepoStackRow(project, repo, stack));
    }
  }
  if (rows.length === 0) return null;

  return h("div", { class: "mt-3" }, [
    h("div", { class: "text-xs text-neutral-500 mb-1" }, ["repos"]),
    h("div", { class: "space-y-1" }, rows),
  ]);
}

function renderFeatureRepoGitRow(project, repo, wt) {
  return h(
    "div",
    {
      class:
        "flex items-center gap-3 text-xs px-2 py-1 rounded bg-neutral-900/40 border border-neutral-800/60",
    },
    [
      // status dot + repo name
      wt.paneLive ? dotPill("agent", "green") : dotPill("idle", "neutral"),
      h("span", { class: "font-mono font-medium text-sm w-16 truncate" }, [repo.name]),
      // branch
      h("span", { class: "text-neutral-500 font-mono truncate flex-1" }, [wt.branch || ""]),
      // mini action icons
      h("div", { class: "flex items-center gap-1" }, [
        btn("MR?", {
          title: "fetch MR/PR status for this repo",
          onClick: async (e) => {
            const button = e.currentTarget;
            button.disabled = true;
            const original = button.textContent;
            button.textContent = "…";
            const { data } = await getJSON(
              `/api/mr/${encodeURIComponent(project.name)}/${encodeURIComponent(repo.name)}/${encodeURIComponent(wt.feature)}`,
            );
            button.disabled = false;
            button.textContent = original;
            if (!data?.ok) {
              toast("info", `${repo.name}/${wt.feature}: no MR`, [data?.error || "unknown"]);
              return;
            }
            const s = data.status || {};
            if (s.url) {
              if (confirm(`${repo.name}/${wt.feature}\nstate: ${s.state}\n\nopen ${s.url}?`)) {
                window.open(s.url, "_blank");
              }
            } else {
              toast("info", `${repo.name}: ${s.state}`, [
                `provider: ${data.provider}`,
                s.ciPipelineStatus ? `CI: ${s.ciPipelineStatus}` : null,
              ].filter(Boolean));
            }
          },
        }),
        btn("cleanup", {
          variant: "danger",
          title: `cleanup just ${repo.name}/${wt.feature} (this repo only)`,
          onClick: () => {
            if (!confirm(`cleanup ${repo.name}/${wt.feature} only? (worktree + branch on this repo)`)) return;
            runAction(
              "/api/actions/cleanup",
              { project: project.name, feature: wt.feature, repo: repo.name },
              `cleanup ${repo.name}/${wt.feature}`,
            );
          },
        }),
      ]),
    ],
  );
}

function renderFeatureRepoStackRow(project, repo, stack) {
  const color = stack.running ? "green" : "neutral";
  const text = stack.running ? "running" : "stopped";
  return h(
    "div",
    {
      class:
        "flex items-center gap-3 text-xs px-2 py-1 rounded bg-neutral-900/40 border border-neutral-800/60",
    },
    [
      dotPill(text, color),
      h("span", { class: "font-mono font-medium text-sm w-16 truncate" }, [repo.name]),
      h("span", { class: "text-neutral-500 font-mono truncate flex-1" }, [
        stack.services.length > 0 ? `${stack.services.length} service${stack.services.length === 1 ? "" : "s"}` : "",
      ]),
      h("div", { class: "flex items-center gap-1" }, [
        btn(stack.running ? "stop" : "up", {
          variant: stack.running ? "default" : "success",
          title: stack.running ? "docker compose down (volumes kept)" : "docker compose up",
          onClick: () => runAction(
            stack.running ? "/api/actions/env/down" : "/api/actions/env/up",
            { project: project.name, feature: stack.feature, repo: repo.name },
            `${stack.running ? "down" : "up"} ${stack.feature}`,
          ),
        }),
        btn("recreate", {
          title: "down -v + up (drops + reseeds volumes)",
          onClick: () => {
            if (!confirm(`recreate stack ${repo.name}/${stack.feature}? drops volumes.`)) return;
            runAction(
              "/api/actions/env/recreate",
              { project: project.name, feature: stack.feature, repo: repo.name },
              `recreate ${repo.name}/${stack.feature}`,
            );
          },
        }),
      ]),
    ],
  );
}

function renderFeatureRow(project, entry) {
  const todoSummary = entry.todo ? `${entry.todo.done}/${entry.todo.total} todo` : null;
  const reposLabel = entry.repos.length > 0 ? entry.repos.join(", ") : "no worktree";
  const next = nextAction(entry);

  // Action bar — depends on what's pending. Plan takes precedence over
  // report (matches the lifecycle).
  const actions = [];
  if (entry.approval?.status === "pending") {
    actions.push(...approveButtons(project, entry, "plan"));
  } else if (entry.reportApproval?.status === "pending") {
    actions.push(...approveButtons(project, entry, "report"));
  }

  const todo = findTodo(project, entry.feature);
  const reports = findReports(project, entry.feature);
  const latestReport = entry.latestReport ?? reports[reports.length - 1];

  // Auto-open features that need user attention.
  const needsAttention =
    entry.approval?.status === "pending"
    || entry.reportApproval?.status === "pending"
    || entry.flag === "blocked"
    || entry.flag === "rejected";

  return h("details", {
    class: "border border-neutral-800 rounded-lg bg-neutral-950 group",
    "data-key": `feature:${project.name}/${entry.feature}`,
    ...(needsAttention ? { open: "" } : {}),
  }, [
    // ── Collapsed summary line ───────────────────────────────────────────
    h("summary", {
      class: "cursor-pointer select-none px-3 py-2 flex items-center gap-3 text-sm",
    }, [
      stagePill(entry),
      h("span", { class: "font-mono font-medium" }, [entry.feature]),
      h("span", { class: "text-xs text-neutral-500" }, [reposLabel]),
      todoSummary
        ? h("span", { class: "text-xs text-neutral-500" }, [todoSummary])
        : null,
      h("span", { class: "ml-auto text-xs text-neutral-400" }, [next ?? ""]),
    ]),

    // ── Drill-down ────────────────────────────────────────────────────────
    h("div", { class: "px-3 pb-3 space-y-3" }, [
      // Feature-level action toolbar (test / rebase / merge / cleanup) —
      // these are the primary actions and operate across every repo of the
      // feature. Approval buttons (when present) come right below.
      renderFeatureActions(project, entry),
      // Plan rejection note (if recently rejected)
      entry.approval?.status === "rejected" && entry.approval.rejectionNote
        ? h("div", { class: "text-xs text-rose-300" }, [
            `plan rejection: ${entry.approval.rejectionNote}`,
          ])
        : null,
      // Per-repo status compact table. Only present when this feature has
      // worktrees/stacks (which is the typical "active feature" case).
      renderFeatureReposBar(project, entry),
      renderTodoChecklist(todo, { scopeKey: `${project.name}/${entry.feature}` }),
      renderLatestReport(latestReport, { scopeKey: `${project.name}/${entry.feature}` }),
      // Older reports (history)
      reports.length > 1
        ? h("details", {
            class: "mt-2",
            "data-key": `older-reports:${project.name}/${entry.feature}`,
          }, [
            h("summary", { class: "cursor-pointer text-xs text-neutral-500 hover:text-neutral-300" }, [
              `older reports (${reports.length - 1})`,
            ]),
            h("div", { class: "mt-2 space-y-2" },
              reports.slice(0, -1).reverse().map((r) => renderReport(r)),
            ),
          ])
        : null,
      actions.length > 0
        ? h("div", { class: "flex gap-2 mt-2" }, actions)
        : null,
    ]),
  ]);
}

function renderPipelineSection(project) {
  const features = project.pipeline;
  if (!features || features.length === 0) return null;
  const inProgress = features.filter((f) => f.stage !== "merged").length;
  return h("section", { class: "border-t border-neutral-800 pt-3 mt-2 space-y-3" }, [
    h("div", { class: "flex items-center justify-between" }, [
      h("h3", { class: "text-sm text-neutral-300 font-medium" }, [
        `🛤  pipeline — ${features.length} feature${features.length > 1 ? "s" : ""}`,
        inProgress < features.length
          ? h("span", { class: "ml-2 text-xs text-neutral-500" }, [
              `(${inProgress} in progress, ${features.length - inProgress} merged)`,
            ])
          : null,
      ]),
      btn("+ new worktree", {
        variant: "primary",
        onClick: () => openNewWorktreeModal(project.name),
      }),
    ]),
    h("div", { class: "space-y-2" }, features.map((f) => renderFeatureRow(project, f))),
  ]);
}

function openNewWorktreeModal(projectName) {
  const promptEl = h("textarea", {
    rows: 4,
    class: "w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-700 resize-none",
    placeholder: "first prompt for the agent (optional — the agent will pick a feature name from it)",
  });
  const featureEl = h("input", {
    type: "text",
    class: "w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700",
    placeholder: "feature name (leave empty for draft → agent will finalize)",
  });
  const modeEl = h("select", {
    class: "bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm",
  }, ["interactive", "assisted", "autonomous", "autopilot"].map((m) =>
    h("option", { value: m, ...(m === "autonomous" ? { selected: "selected" } : {}) }, [m]),
  ));

  const card = h("div", {
    class: "bg-neutral-900 border border-neutral-700 rounded-lg p-4 shadow-2xl space-y-3 w-[min(90vw,32rem)]",
  }, [
    h("div", { class: "text-base font-semibold" }, [`new worktree in '${projectName}'`]),
    h("div", { class: "space-y-2" }, [
      h("div", { class: "text-xs text-neutral-500" }, ["feature name (optional)"]),
      featureEl,
      h("div", { class: "text-xs text-neutral-500 mt-2" }, ["first prompt to the agent"]),
      promptEl,
      h("div", { class: "flex items-center gap-2 mt-2" }, [
        h("label", { class: "text-xs text-neutral-500" }, ["mode:"]),
        modeEl,
      ]),
    ]),
  ]);
  const overlay = h("div", {
    class: "fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4",
    onclick: (e) => { if (e.target === overlay) overlay.remove(); },
  }, [card]);
  const submitBtn = btn("create", {
    variant: "primary",
    onClick: async () => {
      submitBtn.disabled = true;
      const body = {
        project: projectName,
        ...(featureEl.value.trim() ? { feature: featureEl.value.trim() } : {}),
        ...(promptEl.value.trim() ? { initialPrompt: promptEl.value.trim() } : {}),
        mode: modeEl.value,
      };
      const r = await fetch("/api/wt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        const label = data.draft ? `draft (${data.feature}) — agent will finalize` : `created (${data.feature})`;
        toast("success", label);
        overlay.remove();
        scheduleRefresh(true);
      } else {
        toast("error", "create failed", [data.error || `${r.status}`]);
        submitBtn.disabled = false;
      }
    },
  });
  card.appendChild(h("div", { class: "flex justify-end gap-2 pt-2 border-t border-neutral-800" }, [
    btn("cancel", { onClick: () => overlay.remove() }),
    submitBtn,
  ]));
  document.body.appendChild(overlay);
  // Focus first useful field.
  setTimeout(() => promptEl.focus(), 0);
}

function renderProject(project) {
  const activeCount = project.repos.reduce((s, r) => s + r.worktrees.length, 0);
  const runningStacks = project.repos.flatMap((r) => r.stacks).filter((s) => s.running).length;

  // Workflow-first: per-feature pipeline rows are the primary view.
  const pipelineSection = renderPipelineSection(project);

  // Cross-feature conflict matrix — different angle (file × feature),
  // not redundant with the per-feature pipeline. Kept, collapsible.
  const pulseSection = project.pulse && project.pulse.features?.length > 0
    ? h("details", {
        class: "border-t border-neutral-800 pt-3 mt-2",
        "data-key": `pulse:${project.name}`,
      }, [
        h("summary", { class: "cursor-pointer text-xs text-neutral-400 hover:text-neutral-200 mb-2 select-none" }, [
          `🌡 conflict surface (vs origin/${project.pulse.base})`,
        ]),
        renderPulse(project.pulse),
      ])
    : null;

  // If every repo (excluding compose, which has no baseBranch) shares the
  // same base branch, promote it to the project header — saves repeating
  // `base: develop` on every line below.
  const gitRepos = project.repos.filter((r) => r.type !== "compose");
  const sharedBase = gitRepos.length > 0 && gitRepos.every((r) => r.baseBranch === gitRepos[0].baseBranch)
    ? gitRepos[0].baseBranch
    : null;

  // Repos view: lists each repo's worktrees + stacks. We show this section
  // ONLY when the project has no active feature in pipeline — otherwise the
  // per-feature cards (with their per-repo rows inside) already cover all
  // the repo info, and showing a second view would be redundant + put the
  // user back in a "repo-first" mental model that we explicitly moved away
  // from.
  const featuresActive = (project.pipeline ?? []).length > 0;
  const reposSection = featuresActive
    ? null
    : h("div", { class: "border-t border-neutral-800 pt-3 mt-2" }, [
        h("div", { class: "text-xs text-neutral-400 mb-2" }, [
          `repos — ${project.repos.length}${sharedBase ? `, base ${sharedBase}` : ""}`,
        ]),
        h("div", { class: "space-y-4" }, project.repos.map((r) =>
          renderRepo(project, r, { showBase: !sharedBase }),
        )),
      ]);

  return h("section", { class: "bg-neutral-900 border border-neutral-800 rounded-lg p-5" }, [
    h("div", { class: "flex items-center justify-between mb-4" }, [
      h("div", { class: "flex items-center gap-3" }, [
        h("h2", { class: "text-lg font-semibold" }, [project.name]),
        project.sessionRunning ? pill("tmux session live", "green") : pill("session off", "neutral"),
      ]),
      h("div", { class: "flex items-center gap-2 text-xs text-neutral-500" }, [
        h("span", {}, [`${project.repos.length} repos`]),
        sharedBase ? h("span", {}, [`· base ${sharedBase}`]) : null,
        h("span", {}, [`· ${activeCount} worktrees`]),
        runningStacks > 0 ? h("span", { class: "text-emerald-400" }, [`· ${runningStacks} stacks up`]) : null,
      ]),
    ]),
    pipelineSection,
    pulseSection,
    reposSection,
  ]);
}

// Persist <details data-key="…"> open/closed state across re-renders so the
// 2s polling loop doesn't slam shut whatever the user just opened. Keys
// are stable identifiers (e.g. "feature:p4n/login", "infra:p4n").
//
// userOverrides records every explicit toggle the user made, so we can
// distinguish:
//   - "user opened it"   → keep open even if it's not currently a needs-attention feature
//   - "user closed it"   → keep closed even if it would auto-open by default
//   - "no user choice"   → fall back to the renderer's default (auto-open
//                          for features needing attention, closed for
//                          infrastructure / collapsed sections)
const userOverrides = new Map(); // key -> boolean

document.addEventListener("toggle", (e) => {
  const el = e.target;
  if (!(el instanceof HTMLDetailsElement)) return;
  const key = el.getAttribute("data-key");
  if (!key) return;
  userOverrides.set(key, el.open);
}, true);

function applyDetailsState(scope) {
  for (const el of scope.querySelectorAll("details[data-key]")) {
    const key = el.getAttribute("data-key");
    const override = userOverrides.get(key);
    if (override !== undefined) {
      el.open = override;
    }
  }
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
    root.appendChild(h("div", { class: "border border-neutral-800 rounded-lg p-8 text-center bg-neutral-900/50 space-y-3" }, [
      h("p", { class: "text-neutral-300 text-base" }, ["No projects yet."]),
      h("p", { class: "text-neutral-500 text-sm" }, ["Get started by creating one — banyan will write the config and detect tech for each repo."]),
      h("div", { class: "pt-2" }, [
        btn("+ Create project", { variant: "primary", onClick: openNewProjectWizard }),
      ]),
    ]));
    return;
  }

  // Sync the header dropdown against the freshest project list, then scope
  // the Pipeline view to the currently-selected project only.
  syncProjectSelector(state.projects.map((p) => p.name));
  const targetProject = state.projects.find((p) => p.name === currentProject) ?? state.projects[0];
  if (targetProject) {
    root.appendChild(renderProject(targetProject));
  }

  // Restore any open/closed state the user explicitly set.
  applyDetailsState(root);

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

async function fetchReports(projectName) {
  try {
    const r = await fetch(`/api/reports/${encodeURIComponent(projectName)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.reports) ? data.reports : [];
  } catch {
    return [];
  }
}

async function fetchTodos(projectName) {
  try {
    const r = await fetch(`/api/todos/${encodeURIComponent(projectName)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.todos) ? data.todos : [];
  } catch {
    return [];
  }
}

async function fetchApprovals(projectName) {
  try {
    const r = await fetch(`/api/approvals/${encodeURIComponent(projectName)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.approvals) ? data.approvals : [];
  } catch {
    return [];
  }
}

async function fetchPipeline(projectName) {
  try {
    const r = await fetch(`/api/pipeline/${encodeURIComponent(projectName)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data.features) ? data.features : [];
  } catch {
    return [];
  }
}

// ── notifications ──────────────────────────────────────────────────────────
// Fire a browser notification when a never-seen-before report.ts shows up.
// Per-project last-seen ts is stashed in localStorage so reloading doesn't
// re-fire old entries.
async function maybeRequestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
}

function lastSeenKey(projectName) {
  return `banyan.reports.lastSeen.${projectName}`;
}

function notifyNewReports(projectName, reports) {
  if (!Array.isArray(reports) || reports.length === 0) return;
  const key = lastSeenKey(projectName);
  const lastSeen = localStorage.getItem(key) ?? "";
  // Reports are returned in submission order — the last one is newest.
  const newest = reports[reports.length - 1].ts;
  if (newest <= lastSeen) return;

  const fresh = reports.filter((r) => r.ts > lastSeen);
  localStorage.setItem(key, newest);

  // Don't notify on first-ever load (when nothing was seen before): we'd
  // spam the user with the entire history. Set the bookmark silently.
  if (lastSeen === "") return;

  if ("Notification" in window && Notification.permission === "granted") {
    for (const r of fresh) {
      const tag = `${projectName}/${r.feature}/${r.ts}`;
      try {
        new Notification(`${projectName} — ${r.feature}`, {
          body: `[${r.status}] ${r.summary}`,
          tag,
        });
      } catch { /* ignore */ }
    }
  }

  // In-page toast as a fallback (and a redundant cue for users who missed
  // the OS notification).
  toast(
    "info",
    `${fresh.length} new report${fresh.length > 1 ? "s" : ""} — ${projectName}`,
    fresh.map((r) => `[${r.status}] ${r.feature}: ${r.summary}`),
  );
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
    // (it shells out to git diff per worktree). Now that the dashboard scopes
    // to a single project at a time, only fetch heavy data for the visible
    // one — other projects in the dropdown stay light.
    if (Array.isArray(state.projects)) {
      await Promise.all(
        state.projects.map(async (p) => {
          if (currentProject && p.name !== currentProject) return; // not visible
          [p.pulse, p.reports, p.todos, p.approvals, p.pipeline] = await Promise.all([
            fetchPulse(p.name),
            fetchReports(p.name),
            fetchTodos(p.name),
            fetchApprovals(p.name),
            fetchPipeline(p.name),
          ]);
          notifyNewReports(p.name, p.reports);
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

// ── tabs ──────────────────────────────────────────────────────────────────
const shortcutsRoot = document.getElementById("shortcuts-root");
const configRoot = document.getElementById("config-root");
const askRoot = document.getElementById("ask-root");
const historyRoot = document.getElementById("history-root");
const inboxRoot = document.getElementById("inbox-root");
const tabsNav = document.getElementById("tabs");
let currentTab = "pipeline";

function setTab(tab) {
  currentTab = tab;
  root.classList.toggle("hidden", tab !== "pipeline");
  shortcutsRoot.classList.toggle("hidden", tab !== "shortcuts");
  configRoot.classList.toggle("hidden", tab !== "config");
  askRoot.classList.toggle("hidden", tab !== "ask");
  historyRoot.classList.toggle("hidden", tab !== "history");
  inboxRoot.classList.toggle("hidden", tab !== "inbox");
  if (tab === "shortcuts") renderShortcuts();
  if (tab === "config") renderConfig();
  if (tab === "ask") renderAsk();
  if (tab === "history") renderHistory();
  if (tab === "inbox") renderInbox();
  for (const btn of tabsNav.querySelectorAll(".tab-btn")) {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle("bg-neutral-800", isActive);
    btn.classList.toggle("text-emerald-300", isActive);
    btn.classList.toggle("text-neutral-300", !isActive);
  }
  // Persist so a refresh stays on the same tab.
  try { localStorage.setItem("banyan.dashboard.tab", tab); } catch { /* ignore */ }
}

tabsNav.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tab]");
  if (btn) setTab(btn.dataset.tab);
});

// ── shortcuts tab ─────────────────────────────────────────────────────────
let shortcutsState = null; // { actions, bindings, defaults, configPath, tmuxConfPath }
let capturingFor = null;   // action id currently in "press a key" mode

async function loadShortcuts() {
  const r = await fetch("/api/shortcuts");
  if (!r.ok) return null;
  return await r.json();
}

async function renderShortcuts() {
  shortcutsRoot.innerHTML = "";
  if (!shortcutsState) {
    shortcutsRoot.appendChild(h("p", { class: "text-neutral-500" }, ["loading…"]));
    shortcutsState = await loadShortcuts();
    if (!shortcutsState) {
      shortcutsRoot.innerHTML = "";
      shortcutsRoot.appendChild(h("p", { class: "text-rose-400" }, ["failed to load shortcuts"]));
      return;
    }
  }
  shortcutsRoot.innerHTML = "";

  const { actions, bindings, defaults, configPath } = shortcutsState;

  const header = h("div", { class: "flex items-center justify-between" }, [
    h("div", {}, [
      h("h2", { class: "text-lg font-semibold" }, ["Tmux shortcuts"]),
      h("p", { class: "text-xs text-neutral-500 mt-1" }, [
        "Rebind banyan's tmux bindings. Format: Alt + a single letter / digit / '?'. ",
        "Saving regenerates ",
        h("code", { class: "text-neutral-400" }, [configPath]),
        " and applies live to a running tmux server.",
      ]),
    ]),
    h("div", { class: "flex gap-2" }, [
      btn("Reset to defaults", {
        onClick: () => {
          shortcutsState.bindings = { ...defaults };
          renderShortcuts();
        },
      }),
      btn("Save", {
        variant: "primary",
        onClick: () => saveShortcuts(),
      }),
    ]),
  ]);

  // Detect duplicate chords for inline highlight.
  const usage = {};
  for (const [id, chord] of Object.entries(bindings)) {
    if (!usage[chord]) usage[chord] = [];
    usage[chord].push(id);
  }
  const dupChords = new Set(
    Object.entries(usage).filter(([, ids]) => ids.length > 1).map(([c]) => c),
  );

  const rows = actions.map((a) => {
    const chord = bindings[a.id];
    const isCapturing = capturingFor === a.id;
    const isDup = dupChords.has(chord);
    const isCustom = chord !== defaults[a.id];

    const chordCell = h("button", {
      class:
        "px-3 py-1 rounded ring-1 font-mono text-sm transition " +
        (isCapturing
          ? "bg-sky-900 ring-sky-600 text-sky-100 animate-pulse"
          : isDup
          ? "bg-rose-950 ring-rose-700 text-rose-200"
          : "bg-neutral-900 ring-neutral-700 hover:bg-neutral-800 text-neutral-100"),
      title: isCapturing ? "press any key…" : "click then press a key to rebind",
      onclick: () => beginCapture(a.id),
    }, [isCapturing ? "press a key…" : chord]);

    return h("tr", { class: "border-t border-neutral-800" }, [
      h("td", { class: "py-2 pr-4 align-top" }, [
        h("div", { class: "font-medium" }, [a.label]),
        h("div", { class: "text-xs text-neutral-500 mt-0.5" }, [a.description]),
      ]),
      h("td", { class: "py-2 pr-4 align-top" }, [chordCell]),
      h("td", { class: "py-2 align-top text-xs text-neutral-500" }, [
        isCustom
          ? h("button", {
              class: "underline hover:text-neutral-300",
              title: `reset to ${defaults[a.id]}`,
              onclick: () => {
                shortcutsState.bindings[a.id] = defaults[a.id];
                renderShortcuts();
              },
            }, [`custom (default: ${defaults[a.id]})`])
          : "default",
      ]),
    ]);
  });

  const table = h("table", { class: "w-full text-sm" }, [
    h("thead", {}, [
      h("tr", { class: "text-left text-xs uppercase tracking-wide text-neutral-500" }, [
        h("th", { class: "py-2 pr-4 font-normal" }, ["action"]),
        h("th", { class: "py-2 pr-4 font-normal" }, ["chord"]),
        h("th", { class: "py-2 font-normal" }, ["state"]),
      ]),
    ]),
    h("tbody", {}, rows),
  ]);

  shortcutsRoot.appendChild(header);
  if (dupChords.size > 0) {
    shortcutsRoot.appendChild(h("div", { class: "bg-rose-950/40 border border-rose-800 text-rose-200 rounded p-3 text-sm" }, [
      "duplicate chord(s) — fix before saving: " + Array.from(dupChords).join(", "),
    ]));
  }
  shortcutsRoot.appendChild(h("div", { class: "bg-neutral-900 border border-neutral-800 rounded-lg p-5" }, [table]));
}

function beginCapture(actionId) {
  capturingFor = actionId;
  renderShortcuts();
  const handler = (e) => {
    // Accept Alt + single letter/digit/?. Ignore plain modifier presses.
    if (!e.altKey) {
      // Esc cancels.
      if (e.key === "Escape") {
        capturingFor = null;
        document.removeEventListener("keydown", handler, true);
        renderShortcuts();
      }
      return;
    }
    const k = e.key;
    if (k === "Alt" || k === "Meta" || k === "Control" || k === "Shift") return;
    if (!/^[a-zA-Z0-9?]$/.test(k)) {
      toast("error", "invalid chord", ["use Alt + a single letter, digit, or '?'"]);
      capturingFor = null;
      document.removeEventListener("keydown", handler, true);
      renderShortcuts();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const chord = "M-" + k.toLowerCase();
    shortcutsState.bindings[actionId] = chord;
    capturingFor = null;
    document.removeEventListener("keydown", handler, true);
    renderShortcuts();
  };
  document.addEventListener("keydown", handler, true);
}

async function saveShortcuts() {
  const r = await fetch("/api/shortcuts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bindings: shortcutsState.bindings }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok && data.ok) {
    const detail = data.applied === "live"
      ? "applied live to tmux"
      : (data.message || "saved — restart tmux to apply");
    toast("success", "shortcuts saved", [detail]);
    // Reload to pick up any normalisation server-side.
    shortcutsState = await loadShortcuts();
    renderShortcuts();
  } else {
    toast("error", "save failed", [data.error || `${r.status} error`]);
  }
}

// ── config tab ────────────────────────────────────────────────────────────
// Cache of last loaded server-side state, plus a "draft" copy that absorbs
// user edits until they press Save.
let configState = null;     // { projects: [{ name, repos: [...] }] }
let configDrafts = null;    // { "<project>/<repo>": { command, setup, stopCommand, presets, activePreset } }

async function loadConfig() {
  const r = await fetch("/api/config/repos");
  if (!r.ok) return null;
  return await r.json();
}

function repoKey(projectName, repoName) {
  return `${projectName}/${repoName}`;
}

function ensureDraft(projectName, repoName, repo) {
  const k = repoKey(projectName, repoName);
  if (!configDrafts[k]) {
    const run = repo.run ?? { command: "" };
    configDrafts[k] = {
      command: run.command ?? "",
      setup: run.setup ?? "",
      stopCommand: run.stopCommand ?? "",
      presets: run.presets ? { ...run.presets } : {},
      activePreset: run.activePreset ?? "",
    };
  }
  return configDrafts[k];
}

async function renderConfig() {
  configRoot.innerHTML = "";
  if (!configState) {
    configRoot.appendChild(h("p", { class: "text-neutral-500" }, ["loading…"]));
    configState = await loadConfig();
    configDrafts = {};
    if (!configState) {
      configRoot.innerHTML = "";
      configRoot.appendChild(h("p", { class: "text-rose-400" }, ["failed to load config"]));
      return;
    }
  }
  configRoot.innerHTML = "";

  const header = h("div", {}, [
    h("h2", { class: "text-lg font-semibold" }, ["Repo run config"]),
    h("p", { class: "text-xs text-neutral-500 mt-1" }, [
      "Edit the run command, setup, and stop command for each repo. Add named presets to switch between alternatives (e.g. gradle ↔ emulator). The active preset is what ",
      h("code", { class: "text-neutral-400" }, ["bn test"]),
      " will run.",
    ]),
  ]);
  configRoot.appendChild(header);

  // Scope to current project — Config tab inherits the global selector.
  const visibleProjects = currentProject
    ? configState.projects.filter((p) => p.name === currentProject)
    : configState.projects;

  for (const project of visibleProjects) {
    const projectCard = h("section", { class: "bg-neutral-900 border border-neutral-800 rounded-lg p-5 space-y-4" }, [
      h("h3", { class: "text-base font-semibold flex items-center gap-2" }, [
        project.name,
        h("span", { class: "text-xs text-neutral-500 font-normal" }, [`${project.repos.length} repos`]),
      ]),
      ...project.repos.map((r) => renderRepoConfig(project.name, r)),
    ]);
    configRoot.appendChild(projectCard);
  }

  // Integrations section — sources + rules for ClickUp & co.
  const integrationsSection = h("section", {
    class: "bg-neutral-900 border border-neutral-800 rounded-lg p-5 space-y-4",
    id: "integrations-section",
  }, [
    h("div", { class: "flex items-center justify-between" }, [
      h("h3", { class: "text-base font-semibold" }, ["Integrations (Inbox sources + rules)"]),
      h("p", { class: "text-xs text-neutral-500" }, [
        "ClickUp tasks land in the Inbox tab. Filter via rules.",
      ]),
    ]),
    h("div", { id: "integrations-body" }, [
      h("p", { class: "text-xs text-neutral-500" }, ["loading…"]),
    ]),
  ]);
  configRoot.appendChild(integrationsSection);
  // Hydrate async so the rest of the page renders immediately.
  hydrateIntegrationsSection();

  // Discord Rich Presence — focus mode (follow dashboard vs aggregate).
  const discordSection = h("section", {
    class: "bg-neutral-900 border border-neutral-800 rounded-lg p-5 space-y-4",
    id: "discord-section",
  }, [
    h("div", { class: "flex items-center justify-between" }, [
      h("h3", { class: "text-base font-semibold" }, ["Discord Rich Presence"]),
      h("p", { class: "text-xs text-neutral-500" }, [
        "Pick what gets shown on your Discord profile when the dashboard is running.",
      ]),
    ]),
    h("div", { id: "discord-body" }, [
      h("p", { class: "text-xs text-neutral-500" }, ["loading…"]),
    ]),
  ]);
  configRoot.appendChild(discordSection);
  hydrateDiscordSection();
}

// ── Discord RPC focus editor ─────────────────────────────────────────────
async function hydrateDiscordSection() {
  const body = document.getElementById("discord-body");
  if (!body) return;
  let focus, status;
  try {
    [focus, status] = await Promise.all([
      fetch("/api/discord/focus").then((r) => r.json()),
      fetch("/api/discord/enabled").then((r) => r.json()),
    ]);
  } catch {
    body.innerHTML = "";
    body.appendChild(h("p", { class: "text-xs text-rose-400" }, ["failed to load Discord settings"]));
    return;
  }

  const enabled = !!status.enabled;
  const connected = !!status.connected;
  const mode = focus.mode === "aggregate" ? "aggregate" : "follow";
  const pinned = focus.project || "(none)";

  // Enable toggle.
  const toggle = h("input", {
    type: "checkbox",
    class: "h-4 w-4 accent-emerald-500",
    ...(enabled ? { checked: "" } : {}),
  });
  toggle.addEventListener("change", async (e) => {
    const next = e.target.checked;
    try {
      const r = await fetch("/api/discord/enabled", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await r.json();
      toast("success", `Discord Rich Presence ${data.enabled ? "enabled" : "disabled"}`);
      hydrateDiscordSection();
    } catch {
      toast("error", "Failed to toggle Discord");
    }
  });

  const statusBadge = !enabled
    ? h("span", { class: "text-xs text-neutral-500" }, ["off"])
    : connected
      ? h("span", { class: "text-xs text-emerald-400" }, ["● connected to Discord"])
      : h("span", { class: "text-xs text-amber-400" }, ["○ enabled, not connected (is Discord desktop running?)"]);

  // Mode select.
  const select = h("select", {
    class: "bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm",
    ...(enabled ? {} : { disabled: "" }),
  }, [
    h("option", { value: "follow", ...(mode === "follow" ? { selected: "" } : {}) }, ["Follow dashboard project"]),
    h("option", { value: "aggregate", ...(mode === "aggregate" ? { selected: "" } : {}) }, ["Aggregate all projects"]),
  ]);
  select.addEventListener("change", async (e) => {
    const nextMode = e.target.value;
    try {
      await fetch("/api/discord/focus", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      toast("success", `Discord: ${nextMode === "aggregate" ? "aggregating all projects" : "following dashboard"}`);
      hydrateDiscordSection();
    } catch {
      toast("error", "Failed to update Discord mode");
    }
  });

  const followHint = h("p", { class: "text-xs text-neutral-500" }, [
    `Currently mirroring: `,
    h("code", { class: "text-neutral-300" }, [pinned]),
    " (changes when you pick a different project in the header).",
  ]);
  const aggregateHint = h("p", { class: "text-xs text-neutral-500" }, [
    "Shows every running project at once. Feature names are prefixed with their project to avoid collisions.",
  ]);

  body.innerHTML = "";
  body.appendChild(h("label", { class: "flex items-center gap-3 cursor-pointer" }, [
    toggle,
    h("span", { class: "text-sm text-neutral-300" }, ["Enabled"]),
    statusBadge,
  ]));
  body.appendChild(h("div", { class: `flex items-center gap-3 ${enabled ? "" : "opacity-50"}` }, [
    h("label", { class: "text-sm text-neutral-300" }, ["Mode"]),
    select,
  ]));
  body.appendChild(h("div", { class: enabled ? "" : "opacity-50" }, [
    mode === "follow" ? followHint : aggregateHint,
  ]));
}

// ── integrations editor ──────────────────────────────────────────────────
let integrationsState = null; // { config: {sources, rules}, configPath, dirty }

async function hydrateIntegrationsSection() {
  if (!integrationsState) {
    try {
      const r = await fetch("/api/integrations/config");
      const data = await r.json();
      integrationsState = {
        config: data.config ?? { sources: [], rules: [] },
        configPath: data.configPath,
        dirty: false,
      };
    } catch {
      integrationsState = { config: { sources: [], rules: [] }, configPath: "", dirty: false };
    }
  }
  renderIntegrationsBody();
}

function renderIntegrationsBody() {
  const body = document.getElementById("integrations-body");
  if (!body) return;
  body.innerHTML = "";

  const cfg = integrationsState.config;

  const labelClass = "text-xs uppercase tracking-wide text-neutral-500";
  const inputClass = "w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700";

  // ── Sources ─────────────────────────────────────────────────────────
  const sourcesHeader = h("div", { class: "flex items-center justify-between" }, [
    h("h4", { class: "text-sm font-medium text-neutral-300" }, [`Sources (${cfg.sources.length})`]),
    btn("+ source", {
      onClick: () => {
        cfg.sources.push({
          type: "clickup",
          name: `source-${cfg.sources.length + 1}`,
          pollIntervalMin: 5,
          options: { apiToken: "", listId: "" },
        });
        markDirty();
        renderIntegrationsBody();
      },
    }),
  ]);

  const sourceCards = cfg.sources.map((src, idx) => {
    const opts = src.options || {};
    const tokenInput = h("input", {
      type: "password",
      class: inputClass,
      value: opts.apiToken ?? "",
      placeholder: "pk_xxx (ClickUp Personal API Token)",
    });
    tokenInput.addEventListener("input", (e) => { opts.apiToken = e.target.value; markDirty(); });

    const listIdInput = h("input", {
      type: "text",
      class: inputClass,
      value: opts.listId ?? "",
      placeholder: "ClickUp list ID (the number at the end of the list URL)",
    });
    listIdInput.addEventListener("input", (e) => { opts.listId = e.target.value; markDirty(); });

    const nameInput = h("input", {
      type: "text",
      class: inputClass,
      value: src.name ?? "",
      placeholder: "source name (referenced by rules)",
    });
    nameInput.addEventListener("input", (e) => { src.name = e.target.value; markDirty(); });

    const intervalInput = h("input", {
      type: "number",
      min: 1,
      max: 1440,
      class: inputClass + " w-24",
      value: src.pollIntervalMin ?? 5,
    });
    intervalInput.addEventListener("input", (e) => {
      src.pollIntervalMin = parseInt(e.target.value, 10) || 5;
      markDirty();
    });

    return h("div", { class: "border border-neutral-800 rounded p-3 space-y-2" }, [
      h("div", { class: "flex items-center justify-between" }, [
        h("div", { class: "flex items-center gap-2" }, [
          pill(src.type ?? "clickup", "blue"),
          h("span", { class: "font-medium text-sm" }, [src.name || "(unnamed)"]),
        ]),
        btn("✕", {
          variant: "danger",
          title: "remove source",
          onClick: () => {
            cfg.sources.splice(idx, 1);
            markDirty();
            renderIntegrationsBody();
          },
        }),
      ]),
      h("div", { class: "grid grid-cols-1 md:grid-cols-2 gap-3" }, [
        h("div", {}, [h("div", { class: labelClass }, ["name"]), nameInput]),
        h("div", {}, [
          h("div", { class: labelClass }, ["poll interval (minutes)"]),
          intervalInput,
        ]),
        h("div", {}, [h("div", { class: labelClass }, ["API token"]), tokenInput]),
        h("div", {}, [h("div", { class: labelClass }, ["list ID"]), listIdInput]),
      ]),
    ]);
  });

  if (sourceCards.length === 0) {
    body.appendChild(sourcesHeader);
    body.appendChild(h("p", { class: "text-xs text-neutral-500 italic" }, [
      "no sources yet. Add one to start polling ClickUp.",
    ]));
  } else {
    body.appendChild(sourcesHeader);
    for (const card of sourceCards) body.appendChild(card);
  }

  // ── Rules ───────────────────────────────────────────────────────────
  const rulesHeader = h("div", { class: "flex items-center justify-between mt-4" }, [
    h("h4", { class: "text-sm font-medium text-neutral-300" }, [`Rules (${cfg.rules.length})`]),
    btn("+ rule", {
      onClick: () => {
        cfg.rules.push({
          source: cfg.sources[0]?.name ?? "",
          when: {},
          suggest: { project: currentProject ?? "", mode: "autonomous" },
        });
        markDirty();
        renderIntegrationsBody();
      },
    }),
  ]);
  body.appendChild(rulesHeader);

  if (cfg.rules.length === 0) {
    body.appendChild(h("p", { class: "text-xs text-neutral-500 italic" }, [
      "no rules. Without a rule, tasks from a source are skipped.",
    ]));
  } else {
    for (const [idx, rule] of cfg.rules.entries()) {
      body.appendChild(renderIntegrationsRule(rule, idx, cfg.sources));
    }
  }

  // ── Save bar ────────────────────────────────────────────────────────
  const saveBar = h("div", { class: "flex items-center justify-between mt-4 pt-3 border-t border-neutral-800" }, [
    h("span", { class: "text-xs text-neutral-500" }, [
      integrationsState.dirty ? "unsaved changes" : `saved · ${integrationsState.configPath}`,
    ]),
    btn(integrationsState.dirty ? "Save integrations" : "saved", {
      variant: "primary",
      disabled: !integrationsState.dirty,
      onClick: saveIntegrations,
    }),
  ]);
  body.appendChild(saveBar);
}

function renderIntegrationsRule(rule, idx, sources) {
  const inputClass = "w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700";
  const labelClass = "text-xs uppercase tracking-wide text-neutral-500";

  // Source dropdown
  const sourceSel = h("select", { class: inputClass },
    sources.length === 0
      ? [h("option", { value: "" }, ["(no sources)"])]
      : sources.map((s) =>
          h("option", { value: s.name, ...(s.name === rule.source ? { selected: "selected" } : {}) }, [s.name]),
        ),
  );
  sourceSel.addEventListener("change", (e) => { rule.source = e.target.value; markDirty(); });

  // Project dropdown — pull from configState since we have it
  const projects = (configState?.projects ?? []).map((p) => p.name);
  rule.suggest = rule.suggest || {};
  const projectSel = h("select", { class: inputClass },
    projects.length === 0
      ? [h("option", { value: "" }, ["(no projects)"])]
      : projects.map((p) =>
          h("option", { value: p, ...(p === rule.suggest.project ? { selected: "selected" } : {}) }, [p]),
        ),
  );
  projectSel.addEventListener("change", (e) => { rule.suggest.project = e.target.value; markDirty(); });

  const modeSel = h("select", { class: inputClass },
    ["interactive", "assisted", "autonomous", "autopilot"].map((m) =>
      h("option", { value: m, ...(m === (rule.suggest.mode ?? "autonomous") ? { selected: "selected" } : {}) }, [m]),
    ),
  );
  modeSel.addEventListener("change", (e) => { rule.suggest.mode = e.target.value; markDirty(); });

  // Comma-separated lists for when.* (simpler than chip UI for v1)
  rule.when = rule.when || {};
  function csvInput(field, placeholder) {
    const arr = rule.when[field] ?? [];
    const el = h("input", {
      type: "text",
      class: inputClass,
      value: arr.join(", "),
      placeholder,
    });
    el.addEventListener("input", (e) => {
      const v = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
      if (v.length > 0) rule.when[field] = v;
      else delete rule.when[field];
      markDirty();
    });
    return el;
  }

  return h("div", { class: "border border-neutral-800 rounded p-3 space-y-2 mt-2" }, [
    h("div", { class: "flex items-center justify-between" }, [
      h("span", { class: "text-xs text-neutral-500" }, [`rule #${idx + 1}`]),
      btn("✕", {
        variant: "danger",
        title: "remove rule",
        onClick: () => {
          integrationsState.config.rules.splice(idx, 1);
          markDirty();
          renderIntegrationsBody();
        },
      }),
    ]),
    h("div", { class: "grid grid-cols-1 md:grid-cols-3 gap-3" }, [
      h("div", {}, [h("div", { class: labelClass }, ["source"]), sourceSel]),
      h("div", {}, [h("div", { class: labelClass }, ["→ project"]), projectSel]),
      h("div", {}, [h("div", { class: labelClass }, ["→ mode"]), modeSel]),
    ]),
    h("div", { class: "grid grid-cols-1 md:grid-cols-3 gap-3" }, [
      h("div", {}, [
        h("div", { class: labelClass }, ["when assignee in"]),
        csvInput("assigneesAny", "loic@p4n.com, marie@p4n.com (comma-separated)"),
      ]),
      h("div", {}, [
        h("div", { class: labelClass }, ["when status in"]),
        csvInput("statusesAny", "to do, in progress"),
      ]),
      h("div", {}, [
        h("div", { class: labelClass }, ["when tag in"]),
        csvInput("tagsAny", "bug, p1"),
      ]),
    ]),
  ]);
}

function markDirty() {
  if (!integrationsState) return;
  integrationsState.dirty = true;
  // Re-render only the save bar to avoid losing focus on text inputs.
  const old = document.querySelector("#integrations-body > div.flex.items-center.justify-between.mt-4.pt-3");
  if (old) {
    old.querySelector("span").textContent = "unsaved changes";
    const btn = old.querySelector("button");
    if (btn) { btn.disabled = false; btn.textContent = "Save integrations"; }
  }
}

async function saveIntegrations() {
  try {
    const r = await fetch("/api/integrations/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: integrationsState.config }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) {
      integrationsState.dirty = false;
      toast("success", "integrations saved", [`${data.sourceCount} source${data.sourceCount === 1 ? "" : "s"} polling`]);
      renderIntegrationsBody();
    } else {
      toast("error", "save failed", [data.error || `${r.status}`]);
    }
  } catch (err) {
    toast("error", "save failed", [err.message]);
  }
}

function renderRepoConfig(projectName, repo) {
  if (repo.type === "compose") {
    return h("div", { class: "border-t border-neutral-800 pt-3 text-xs text-neutral-500" }, [
      h("div", { class: "font-medium text-neutral-300" }, [repo.name + " (compose)"]),
      "compose stacks are managed via docker-compose — no run command to edit.",
    ]);
  }
  if (!repo.run) {
    return h("div", { class: "border-t border-neutral-800 pt-3 text-xs text-neutral-500" }, [
      h("div", { class: "font-medium text-neutral-300" }, [repo.name]),
      "no run config set. Add one in your config.yaml first.",
    ]);
  }

  const draft = ensureDraft(projectName, repo.name, repo);
  const presets = draft.presets;
  const presetNames = Object.keys(presets);

  const effective = draft.activePreset && presets[draft.activePreset]
    ? presets[draft.activePreset]
    : draft.command;

  const labelClass = "text-xs uppercase tracking-wide text-neutral-500";
  const inputClass = "w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700";

  function input(value, onInput, placeholder = "") {
    const el = h("input", {
      type: "text",
      class: inputClass,
      placeholder,
      value: value ?? "",
    });
    el.addEventListener("input", (e) => onInput(e.target.value));
    return el;
  }

  // Preset rows
  const presetRows = presetNames.map((name) => {
    const isActive = draft.activePreset === name;
    return h("div", { class: "flex items-center gap-2" }, [
      h("label", { class: "flex items-center gap-1 text-xs text-neutral-400" }, [
        (() => {
          const r = h("input", { type: "radio", name: `active-${projectName}-${repo.name}` });
          r.checked = isActive;
          r.addEventListener("change", () => {
            draft.activePreset = name;
            renderConfig();
          });
          return r;
        })(),
        "active",
      ]),
      h("span", { class: "px-2 py-1 text-xs rounded bg-neutral-800 text-neutral-200 font-mono min-w-[6rem] text-center" }, [name]),
      input(presets[name], (v) => { presets[name] = v; }, "command for this preset"),
      btn("✕", {
        title: "remove preset",
        onClick: () => {
          delete presets[name];
          if (draft.activePreset === name) draft.activePreset = "";
          renderConfig();
        },
      }),
    ]);
  });

  // Add-preset row
  const newNameRef = { value: "" };
  const newCmdRef = { value: "" };
  const addRow = h("div", { class: "flex items-center gap-2 mt-2" }, [
    (() => {
      const el = h("input", { type: "text", class: inputClass + " max-w-[10rem]", placeholder: "preset name" });
      el.addEventListener("input", (e) => { newNameRef.value = e.target.value; });
      return el;
    })(),
    (() => {
      const el = h("input", { type: "text", class: inputClass, placeholder: "command" });
      el.addEventListener("input", (e) => { newCmdRef.value = e.target.value; });
      return el;
    })(),
    btn("+ add", {
      variant: "primary",
      onClick: () => {
        const name = newNameRef.value.trim();
        const cmd = newCmdRef.value.trim();
        if (!name || !cmd) {
          toast("error", "preset name and command are required");
          return;
        }
        if (!/^[\w.-]+$/.test(name)) {
          toast("error", "preset name must match [A-Za-z0-9_.-]+");
          return;
        }
        if (presets[name]) {
          toast("error", `preset '${name}' already exists`);
          return;
        }
        presets[name] = cmd;
        renderConfig();
      },
    }),
  ]);

  // "use default" radio so the user can revert to the plain `command`.
  const useDefaultRow = h("div", { class: "flex items-center gap-2" }, [
    h("label", { class: "flex items-center gap-1 text-xs text-neutral-400" }, [
      (() => {
        const r = h("input", { type: "radio", name: `active-${projectName}-${repo.name}` });
        r.checked = !draft.activePreset;
        r.addEventListener("change", () => {
          draft.activePreset = "";
          renderConfig();
        });
        return r;
      })(),
      "use default command",
    ]),
  ]);

  return h("div", { class: "border-t border-neutral-800 pt-3 space-y-3" }, [
    h("div", { class: "flex items-center justify-between" }, [
      h("div", { class: "flex items-center gap-2" }, [
        h("span", { class: "font-medium" }, [repo.name]),
        h("span", { class: "text-xs text-neutral-500" }, [repo.path]),
      ]),
      h("div", { class: "flex items-center gap-2" }, [
        h("span", { class: "text-xs text-neutral-500" }, ["effective:"]),
        h("code", { class: "text-xs text-emerald-300 bg-neutral-950 px-2 py-0.5 rounded font-mono" }, [effective || "(empty)"]),
        btn("Save", {
          variant: "primary",
          onClick: () => saveRepoRun(projectName, repo.name),
        }),
      ]),
    ]),

    h("div", { class: "grid grid-cols-1 md:grid-cols-2 gap-3" }, [
      h("div", {}, [
        h("div", { class: labelClass }, ["default command"]),
        input(draft.command, (v) => { draft.command = v; }, "./gradlew installDebug"),
      ]),
      h("div", {}, [
        h("div", { class: labelClass }, ["setup (run once before command)"]),
        input(draft.setup, (v) => { draft.setup = v; }, "optional, e.g. nvm use 20"),
      ]),
      h("div", {}, [
        h("div", { class: labelClass }, ["stop command (used by bn test-stop)"]),
        input(draft.stopCommand, (v) => { draft.stopCommand = v; }, "optional, e.g. ./gradlew --stop"),
      ]),
    ]),

    h("div", {}, [
      h("div", { class: labelClass + " mb-2" }, [`presets (${presetNames.length})`]),
      useDefaultRow,
      ...presetRows,
      addRow,
    ]),
  ]);
}

async function saveRepoRun(projectName, repoName) {
  const draft = configDrafts[repoKey(projectName, repoName)];
  if (!draft) return;
  const payload = {
    project: projectName,
    repo: repoName,
    run: {
      command: draft.command,
      setup: draft.setup,
      stopCommand: draft.stopCommand,
      presets: draft.presets,
      activePreset: draft.activePreset,
    },
  };
  const r = await fetch("/api/config/repos/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok && data.ok) {
    toast("success", `${projectName}/${repoName} saved`);
    // Refresh from server so we display the canonical state.
    configState = await loadConfig();
    delete configDrafts[repoKey(projectName, repoName)];
    renderConfig();
  } else {
    toast("error", "save failed", [data.error || `${r.status} error`]);
  }
}

// ── ask tab ───────────────────────────────────────────────────────────────
let askState = {
  projectName: null,     // selected project
  projectList: [],
  history: [],           // newest first
  pending: null,         // { question, answerSoFar, error? } while streaming
  feature: "",
  includeTranscripts: true,
  days: 30,
};

async function fetchAskHistory(projectName) {
  const r = await fetch(`/api/ask/${encodeURIComponent(projectName)}/history?limit=50`);
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  return Array.isArray(data.records) ? data.records : [];
}

async function loadProjectListForAsk() {
  const r = await fetch("/api/state");
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  return Array.isArray(data.projects) ? data.projects.map((p) => p.name) : [];
}

async function renderAsk() {
  // Project is now picked at the header level; this tab inherits.
  askState.projectName = currentProject;
  if (askState.projectName) {
    askState.history = await fetchAskHistory(askState.projectName);
  } else {
    askState.history = [];
  }
  renderAskUI();
}

function renderAskUI() {
  askRoot.innerHTML = "";

  const header = h("div", { class: "flex items-center justify-between gap-3 flex-wrap" }, [
    h("div", {}, [
      h("h2", { class: "text-lg font-semibold" }, ["Ask"]),
      h("p", { class: "text-xs text-neutral-500 mt-1" }, [
        "Ask a question about this project's past work. Banyan assembles reports + recent commits + filtered agent transcripts, ",
        "then streams Claude's answer (uses ",
        h("code", { class: "text-neutral-400" }, ["claude --print"]),
        " under the hood, so your existing Claude Code auth applies).",
      ]),
    ]),
  ]);

  // Input area
  const inputWrap = h("div", { class: "bg-neutral-900 border border-neutral-800 rounded-lg p-4 space-y-3" }, []);
  const textarea = h("textarea", {
    class: "w-full bg-neutral-950 border border-neutral-800 rounded p-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700 resize-none",
    rows: 3,
    placeholder: "e.g. why did we drop the bn whereami command? · what changed in the auth flow last week? · what's the status of the search-zone feature?",
  });
  textarea.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitAsk(textarea.value);
    }
  });

  const featureInput = h("input", {
    type: "text",
    class: "bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono w-48",
    placeholder: "any feature",
    value: askState.feature,
  });
  featureInput.addEventListener("input", (e) => { askState.feature = e.target.value; });

  const daysInput = h("input", {
    type: "number",
    min: 1,
    max: 365,
    class: "bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono w-20",
    value: String(askState.days),
  });
  daysInput.addEventListener("input", (e) => { askState.days = parseInt(e.target.value, 10) || 30; });

  const txCheckbox = h("input", {
    type: "checkbox",
    class: "accent-sky-500",
  });
  txCheckbox.checked = askState.includeTranscripts;
  txCheckbox.addEventListener("change", (e) => { askState.includeTranscripts = e.target.checked; });

  const submitBtn = btn(askState.pending ? "streaming…" : "Ask (⌘↵)", {
    variant: "primary",
    disabled: !!askState.pending,
    onClick: () => submitAsk(textarea.value),
  });

  inputWrap.appendChild(textarea);
  inputWrap.appendChild(
    h("div", { class: "flex flex-wrap items-center gap-4 text-xs text-neutral-400" }, [
      h("label", { class: "flex items-center gap-1" }, ["feature:", featureInput]),
      h("label", { class: "flex items-center gap-1" }, ["days of commits:", daysInput]),
      h("label", { class: "flex items-center gap-1" }, [txCheckbox, "include transcripts"]),
      h("div", { class: "ml-auto" }, [submitBtn]),
    ]),
  );

  // Pending answer (currently streaming)
  let pendingBlock = null;
  if (askState.pending) {
    pendingBlock = h("div", { class: "bg-neutral-900 border border-sky-800/50 rounded-lg p-4 space-y-2" }, [
      h("div", { class: "text-xs text-sky-300" }, ["streaming…"]),
      h("div", { class: "text-sm font-medium text-neutral-200" }, [askState.pending.question]),
      h("pre", { class: "whitespace-pre-wrap text-sm text-neutral-300 font-sans" },
        [askState.pending.answerSoFar || "…"]),
    ]);
  }

  // History
  const historyBlock = askState.history.length === 0
    ? h("p", { class: "text-sm text-neutral-500" }, ["no past questions yet for this project."])
    : h("div", { class: "space-y-3" }, askState.history.map(renderAskRecord));

  askRoot.appendChild(header);
  askRoot.appendChild(inputWrap);
  if (pendingBlock) askRoot.appendChild(pendingBlock);
  askRoot.appendChild(h("h3", { class: "text-sm font-semibold text-neutral-400 mt-4" }, [
    `History (${askState.history.length})`,
  ]));
  askRoot.appendChild(historyBlock);
}

function renderAskRecord(rec) {
  const when = new Date(rec.ts).toLocaleString();
  const dur = rec.durationMs ? ` · ${(rec.durationMs / 1000).toFixed(1)}s` : "";
  const scope = rec.scope?.feature ? ` · feature ${rec.scope.feature}` : "";
  return h("details", { class: "bg-neutral-900 border border-neutral-800 rounded p-3" }, [
    h("summary", { class: "cursor-pointer text-sm font-medium select-none" }, [
      rec.question,
      h("span", { class: "ml-2 text-xs text-neutral-500" }, [`${when}${dur}${scope}`]),
    ]),
    h("pre", { class: "mt-2 whitespace-pre-wrap text-sm text-neutral-300 font-sans" }, [rec.answer]),
  ]);
}

async function submitAsk(question) {
  question = (question || "").trim();
  if (!question || !askState.projectName) return;
  if (askState.pending) return;

  askState.pending = { question, answerSoFar: "" };
  renderAskUI();

  try {
    const r = await fetch(`/api/ask/${encodeURIComponent(askState.projectName)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "text/event-stream" },
      body: JSON.stringify({
        question,
        feature: askState.feature || undefined,
        days: askState.days,
        includeTranscripts: askState.includeTranscripts,
      }),
    });
    if (!r.ok || !r.body) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${r.status}`);
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Parse SSE frames separated by \n\n.
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = "message";
        let dataLine = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataLine += line.slice(6);
        }
        if (!dataLine) continue;
        const data = JSON.parse(dataLine);
        if (event === "chunk") {
          askState.pending.answerSoFar += data.text;
          // Update only the pending block to avoid re-rendering the input.
          updatePendingDisplay();
        } else if (event === "done") {
          askState.pending = null;
          askState.history = [data.record, ...askState.history];
          renderAskUI();
          return;
        } else if (event === "error") {
          throw new Error(data.message || "stream error");
        }
      }
    }
    askState.pending = null;
    renderAskUI();
  } catch (err) {
    toast("error", "ask failed", [err.message]);
    askState.pending = null;
    renderAskUI();
  }
}

function updatePendingDisplay() {
  // Cheap incremental update — find the streaming <pre> and rewrite it.
  const pre = askRoot.querySelector(".border-sky-800\\/50 pre");
  if (pre && askState.pending) {
    pre.textContent = askState.pending.answerSoFar || "…";
  }
}

// ── history tab ───────────────────────────────────────────────────────────
let historyState = {
  projectName: null,
  projectList: [],
  events: [],
};

async function fetchHistoryEvents(projectName) {
  const r = await fetch(`/api/history/${encodeURIComponent(projectName)}?limit=500`);
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  return Array.isArray(data.events) ? data.events : [];
}

async function renderHistory() {
  historyState.projectName = currentProject;
  if (historyState.projectName) {
    historyState.events = await fetchHistoryEvents(historyState.projectName);
  } else {
    historyState.events = [];
  }
  renderHistoryUI();
}

function renderHistoryUI() {
  historyRoot.innerHTML = "";
  const header = h("div", { class: "flex items-center justify-between gap-3 flex-wrap" }, [
    h("div", {}, [
      h("h2", { class: "text-lg font-semibold" }, ["History"]),
      h("p", { class: "text-xs text-neutral-500 mt-1" }, [
        "Every successful banyan action recorded since the recorder was added. Cross-repo grouping by feature, plus a per-event timeline.",
      ]),
    ]),
    btn("refresh", {
      onClick: async () => {
        if (historyState.projectName) {
          historyState.events = await fetchHistoryEvents(historyState.projectName);
          renderHistoryUI();
        }
      },
    }),
  ]);
  historyRoot.appendChild(header);

  if (historyState.events.length === 0) {
    historyRoot.appendChild(h("p", { class: "text-sm text-neutral-500 italic" }, [
      "no events yet. the recorder logs every successful merge / cleanup / rebase — this fills up as you ship.",
    ]));
    return;
  }

  // ── Pivot table: feature × repo ─────────────────────────────────────
  historyRoot.appendChild(renderHistoryPivot(historyState.events));

  // ── Raw timeline (collapsible) ──────────────────────────────────────
  historyRoot.appendChild(renderHistoryTimeline(historyState.events));
}

function renderHistoryPivot(events) {
  // Only merges contribute to the pivot view (the headline question:
  // what shipped, in which repos, in what order).
  const merges = events.filter((e) => e.kind === "merge");
  if (merges.length === 0) {
    return h("p", { class: "text-sm text-neutral-500 italic" }, [
      "no merge events yet — the pivot table fills up as features merge.",
    ]);
  }

  // Discover the set of repos used across these merges, in order of first appearance.
  const repoOrder = [];
  for (const e of merges) {
    if (!repoOrder.includes(e.repo)) repoOrder.push(e.repo);
  }
  // Group merges by feature; first-seen-ts decides feature order.
  const byFeature = new Map();
  for (const e of merges) {
    if (!byFeature.has(e.feature)) byFeature.set(e.feature, { firstTs: e.ts, repos: {} });
    const slot = byFeature.get(e.feature);
    if (e.ts < slot.firstTs) slot.firstTs = e.ts;
    slot.repos[e.repo] = e;
  }
  const features = [...byFeature.entries()].sort((a, b) => a[1].firstTs.localeCompare(b[1].firstTs));

  const mergeOrderLine = features.map(([f]) => f).join(" → ");

  const headRow = h("tr", { class: "text-left text-xs uppercase tracking-wide text-neutral-500" }, [
    h("th", { class: "py-2 pr-3 font-normal" }, ["feature"]),
    ...repoOrder.map((r) => h("th", { class: "py-2 pr-3 font-normal" }, [r])),
    h("th", { class: "py-2 pr-3 font-normal" }, ["first merge"]),
  ]);

  const rows = features.map(([feature, slot]) => {
    const cells = repoOrder.map((repo) => {
      const ev = slot.repos[repo];
      if (!ev) {
        return h("td", { class: "py-2 pr-3 text-neutral-600 text-sm align-top" }, ["—"]);
      }
      const numLabel = ev.local
        ? "local"
        : (ev.mrNumber !== undefined ? `MR #${ev.mrNumber}` : "merged");
      // Build tooltip with title, body excerpt, author, diff stats.
      const tooltipParts = [];
      if (ev.mrTitle) tooltipParts.push(ev.mrTitle);
      if (ev.mrAuthor) tooltipParts.push(`by @${ev.mrAuthor}`);
      const stats = [];
      if (ev.filesChanged !== undefined) stats.push(`${ev.filesChanged} files`);
      if (ev.additions !== undefined || ev.deletions !== undefined) {
        stats.push(`+${ev.additions ?? 0}/-${ev.deletions ?? 0}`);
      }
      if (stats.length) tooltipParts.push(stats.join(" · "));
      if (ev.mrBody) {
        const bodyExcerpt = ev.mrBody.length > 400 ? ev.mrBody.slice(0, 400) + "…" : ev.mrBody;
        tooltipParts.push("");
        tooltipParts.push(bodyExcerpt);
      }
      const tooltip = tooltipParts.length > 0 ? tooltipParts.join("\n") : `${ev.provider ?? "merged"} — ${ev.mrUrl ?? ""}`;

      // Cell content: MR# link + title line below it (if available).
      const head = ev.mrUrl
        ? h("a", {
            href: ev.mrUrl,
            target: "_blank",
            class: "text-sky-300 hover:text-sky-200 text-sm underline-offset-2 hover:underline",
            title: tooltip,
          }, [numLabel])
        : h("span", { class: "text-neutral-200 text-sm", title: tooltip }, [numLabel]);

      const children = [head];
      if (ev.mrTitle) {
        const titleClipped = ev.mrTitle.length > 60 ? ev.mrTitle.slice(0, 60) + "…" : ev.mrTitle;
        children.push(
          h("div", { class: "text-xs text-neutral-400 mt-0.5", title: tooltip }, [titleClipped]),
        );
      }
      if (ev.filesChanged !== undefined || ev.additions !== undefined) {
        const parts = [];
        if (ev.filesChanged !== undefined) parts.push(`${ev.filesChanged}f`);
        if (ev.additions !== undefined || ev.deletions !== undefined) {
          parts.push(`+${ev.additions ?? 0}/-${ev.deletions ?? 0}`);
        }
        children.push(
          h("div", { class: "text-xs text-neutral-600 mt-0.5 font-mono" }, [parts.join(" ")]),
        );
      }
      return h("td", { class: "py-2 pr-3 align-top" }, [
        h("div", {}, children),
      ]);
    });
    return h("tr", { class: "border-t border-neutral-800" }, [
      h("td", { class: "py-2 pr-3 font-medium text-sm align-top" }, [feature]),
      ...cells,
      h("td", { class: "py-2 pr-3 text-neutral-500 text-xs align-top" }, [
        new Date(slot.firstTs).toLocaleString(),
      ]),
    ]);
  });

  return h("div", { class: "bg-neutral-900 border border-neutral-800 rounded-lg p-5 space-y-3" }, [
    h("div", { class: "text-xs text-neutral-400" }, [
      h("span", { class: "text-neutral-500" }, ["Merge order : "]),
      h("span", { class: "text-emerald-300 font-mono" }, [mergeOrderLine]),
    ]),
    h("table", { class: "w-full text-sm" }, [
      h("thead", {}, [headRow]),
      h("tbody", {}, rows),
    ]),
  ]);
}

function renderHistoryTimeline(events) {
  const rows = events.map((e) => {
    const when = new Date(e.ts).toLocaleString();
    let badge, detail;
    if (e.kind === "merge") {
      badge = pill(e.local ? "merge (local)" : "merge", "green");
      const linkOrText = e.mrUrl
        ? h("a", {
            href: e.mrUrl, target: "_blank",
            class: "text-sky-300 hover:text-sky-200 underline-offset-2 hover:underline",
          }, [e.mrNumber !== undefined ? `MR #${e.mrNumber}` : e.mrUrl])
        : h("span", { class: "text-neutral-300" }, ["—"]);
      const titlePart = e.mrTitle
        ? h("span", { class: "text-neutral-300", title: e.mrBody || "" }, [` — ${e.mrTitle}`])
        : null;
      detail = h("span", { class: "text-xs text-neutral-400" }, [
        `${e.repo} into ${e.base} (${e.strategy ?? "—"}) `,
        linkOrText,
        titlePart,
      ]);
    } else if (e.kind === "cleanup") {
      badge = pill("cleanup", "neutral");
      detail = h("span", { class: "text-xs text-neutral-400" }, [
        `${e.repo}${e.forced ? " (forced)" : ""}`,
      ]);
    } else if (e.kind === "rebase") {
      badge = pill("rebase", "blue");
      detail = h("span", { class: "text-xs text-neutral-400" }, [
        `${e.repo} on ${e.base}` + (e.durationMs ? ` · ${(e.durationMs / 1000).toFixed(1)}s` : ""),
      ]);
    } else {
      badge = pill(e.kind, "neutral");
      detail = null;
    }
    return h("tr", { class: "border-t border-neutral-800" }, [
      h("td", { class: "py-1.5 pr-3 text-xs text-neutral-500 font-mono whitespace-nowrap" }, [when]),
      h("td", { class: "py-1.5 pr-3" }, [badge]),
      h("td", { class: "py-1.5 pr-3 text-sm font-medium" }, [e.feature]),
      h("td", { class: "py-1.5 pr-3" }, [detail]),
    ]);
  });

  return h("details", { class: "bg-neutral-900 border border-neutral-800 rounded-lg p-4" }, [
    h("summary", { class: "cursor-pointer text-sm font-medium text-neutral-300 select-none" }, [
      `Timeline (${events.length} events)`,
    ]),
    h("table", { class: "w-full mt-3 text-sm" }, [
      h("tbody", {}, rows),
    ]),
  ]);
}

// ── inbox tab ─────────────────────────────────────────────────────────────
let inboxState = {
  configured: 0,
  entries: [],
  includeArchived: false,
  polling: false,
};

async function fetchInbox() {
  const params = new URLSearchParams();
  if (inboxState.includeArchived) params.set("includeArchived", "1");
  const r = await fetch(`/api/integrations/inbox?${params}`);
  if (!r.ok) return { configured: 0, entries: [] };
  return await r.json();
}

async function renderInbox() {
  const data = await fetchInbox();
  inboxState.configured = data.configured ?? 0;
  // Scope to current project: show tasks suggested for it, or tasks with no
  // suggested project (so the user can still triage uncategorised ones).
  const all = data.entries ?? [];
  inboxState.entries = currentProject
    ? all.filter((e) => !e.suggestedProject || e.suggestedProject === currentProject)
    : all;
  renderInboxUI();
}

function renderInboxUI() {
  inboxRoot.innerHTML = "";

  const header = h("div", { class: "flex items-center justify-between gap-3 flex-wrap" }, [
    h("div", {}, [
      h("h2", { class: "text-lg font-semibold" }, ["Inbox"]),
      h("p", { class: "text-xs text-neutral-500 mt-1" }, [
        inboxState.configured === 0
          ? "no integrations configured — create ~/.config/banyan/integrations.yaml"
          : `${inboxState.configured} source${inboxState.configured > 1 ? "s" : ""} polling. tasks land here. click "spawn" to start a banyan worktree from a task.`,
      ]),
    ]),
    h("div", { class: "flex items-center gap-2 text-xs" }, [
      h("label", { class: "flex items-center gap-1 text-neutral-400" }, [
        (() => {
          const cb = h("input", { type: "checkbox", class: "accent-sky-500" });
          cb.checked = inboxState.includeArchived;
          cb.addEventListener("change", async (e) => {
            inboxState.includeArchived = e.target.checked;
            await renderInbox();
          });
          return cb;
        })(),
        "show archived",
      ]),
      btn(inboxState.polling ? "polling…" : "poll now", {
        variant: "primary",
        disabled: inboxState.polling,
        onClick: pollInboxNow,
      }),
    ]),
  ]);
  inboxRoot.appendChild(header);

  if (inboxState.entries.length === 0) {
    inboxRoot.appendChild(h("p", { class: "text-sm text-neutral-500 italic" }, [
      inboxState.configured === 0
        ? "configure an integration to see tasks here."
        : "no tasks matching your rules right now. (poll now to refresh)",
    ]));
    return;
  }

  for (const entry of inboxState.entries) {
    inboxRoot.appendChild(renderInboxCard(entry));
  }
}

function renderInboxCard(entry) {
  const t = entry.task;
  const archived = entry.spawnedAt || entry.dismissedAt;
  const cardClass = archived
    ? "bg-neutral-900/50 border border-neutral-800 rounded p-4 space-y-2 opacity-60"
    : "bg-neutral-900 border border-neutral-800 rounded p-4 space-y-2";

  // Status / source pill row
  const meta = [];
  meta.push(pill(t.source, "neutral"));
  if (t.status) meta.push(pill(t.status, "blue"));
  if (entry.spawnedAt) meta.push(pill("spawned", "green"));
  if (entry.dismissedAt) meta.push(pill("dismissed", "neutral"));

  const titleEl = t.url
    ? h("a", {
        href: t.url, target: "_blank",
        class: "font-medium text-neutral-100 hover:text-sky-300 underline-offset-2 hover:underline",
      }, [t.title])
    : h("span", { class: "font-medium text-neutral-100" }, [t.title]);

  const descEl = t.description && t.description.trim()
    ? h("pre", {
        class: "text-xs text-neutral-400 whitespace-pre-wrap font-sans max-h-32 overflow-auto",
      }, [t.description.trim()])
    : h("p", { class: "text-xs text-neutral-600 italic" }, ["(no description)"]);

  const footer = h("div", { class: "flex items-center justify-between gap-3 text-xs text-neutral-500 flex-wrap pt-1" }, [
    h("div", { class: "flex items-center gap-2 flex-wrap" }, [
      h("span", {}, [`assignees: ${t.assignees.length > 0 ? t.assignees.join(", ") : "(none)"}`]),
      entry.suggestedProject
        ? h("span", { class: "text-emerald-300" }, [`→ ${entry.suggestedProject}`])
        : null,
    ]),
    !archived
      ? h("div", { class: "flex items-center gap-2" }, [
          (() => {
            const sel = h("select", {
              class: "bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-xs",
              title: "agent mode — autopilot enforces a final report; autonomous instructs but doesn't block",
            }, ["interactive", "assisted", "autonomous", "autopilot"].map((m) =>
              h("option", {
                value: m,
                ...(m === (entry.suggestedMode || "autonomous") ? { selected: "selected" } : {}),
              }, [m]),
            ));
            sel.dataset.role = "mode";
            return sel;
          })(),
          btn("dismiss", { onClick: () => dismissTask(t.id) }),
          btn("spawn agent", {
            variant: "primary",
            onClick: (e) => {
              const modeSel = e.target.closest("div").querySelector('select[data-role="mode"]');
              spawnFromTask(entry, modeSel?.value);
            },
          }),
        ])
      : entry.spawnedAt
      ? h("span", { class: "text-emerald-300" }, [
          `spawned ${new Date(entry.spawnedAt).toLocaleString()} → ${entry.spawnedProject}/${entry.spawnedFeature}`,
        ])
      : h("span", {}, [`dismissed ${new Date(entry.dismissedAt).toLocaleString()}${entry.dismissNote ? ` — ${entry.dismissNote}` : ""}`]),
  ]);

  return h("div", { class: cardClass }, [
    h("div", { class: "flex items-center gap-2 flex-wrap" }, meta),
    titleEl,
    descEl,
    footer,
  ]);
}

async function pollInboxNow() {
  inboxState.polling = true;
  renderInboxUI();
  try {
    const r = await fetch("/api/integrations/poll", { method: "POST" });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) {
      const lines = [];
      if (data.added) lines.push(`${data.added} new`);
      if (data.refreshed) lines.push(`${data.refreshed} refreshed`);
      if (data.errors?.length) {
        for (const e of data.errors) lines.push(`error in ${e.source}: ${e.error}`);
      }
      toast(data.errors?.length ? "error" : "success", "polled all sources", lines);
    } else {
      toast("error", "poll failed", [data.error || `${r.status}`]);
    }
  } catch (err) {
    toast("error", "poll failed", [err.message]);
  } finally {
    inboxState.polling = false;
    await renderInbox();
  }
}

async function dismissTask(taskId) {
  const r = await fetch("/api/integrations/dismiss", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId }),
  });
  if (r.ok) {
    toast("info", "dismissed");
    await renderInbox();
  } else {
    const data = await r.json().catch(() => ({}));
    toast("error", "dismiss failed", [data.error || `${r.status}`]);
  }
}

async function spawnFromTask(entry, modeOverride) {
  // Use the suggested project if any; otherwise pick the first project.
  let project = entry.suggestedProject;
  if (!project) {
    const projects = await loadProjectListForAsk();
    project = projects[0];
  }
  if (!project) {
    toast("error", "no project to spawn into");
    return;
  }
  const mode = modeOverride || entry.suggestedMode || "autonomous";
  // Show a brief confirmation toast — there might be many in flight.
  toast("info", `spawning agent in ${project} (${mode})…`, [entry.task.title]);
  const r = await fetch("/api/integrations/spawn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: entry.task.id,
      project,
      mode,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.ok && data.ok) {
    toast("success", `spawned (${data.feature})`, ["agent will finalize the feature name from the task description"]);
    await renderInbox();
    scheduleRefresh(true);
  } else {
    toast("error", "spawn failed", [data.error || `${r.status}`]);
  }
}

// Restore last tab on load.
try {
  const saved = localStorage.getItem("banyan.dashboard.tab");
  if (["shortcuts", "config", "ask", "history", "inbox"].includes(saved)) setTab(saved);
  else setTab("pipeline");
} catch {
  setTab("pipeline");
}

// Ask once on first load — non-blocking.
maybeRequestNotificationPermission();
loop();

// ── new-project wizard ────────────────────────────────────────────────────
// 3-step modal (name → repos → review). Calls /api/projects on submit and
// refreshes the dashboard on success.

async function openNewProjectWizard() {
  // Tech profiles are tiny and rarely change — fetch once per wizard open.
  let profiles;
  try {
    const r = await fetch("/api/tech-profiles");
    const data = await r.json();
    profiles = data.profiles;
  } catch {
    toast("error", "could not load tech profiles");
    return;
  }
  if (!Array.isArray(profiles) || profiles.length === 0) {
    toast("error", "no tech profiles available");
    return;
  }

  // Wizard state — single source of truth for the 3 steps.
  const state = {
    step: 1,
    name: "",
    repos: [],         // { name, path, baseBranch, tech, run: {command, port, portEnv, setup, stopCommand} }
  };

  const overlay = h("div", {
    class: "fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4",
    onclick: (e) => { if (e.target === overlay) close(); },
  });
  const card = h("div", {
    class: "bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-[min(95vw,42rem)] max-h-[90vh] flex flex-col",
  });
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); }
  function rerender() { card.innerHTML = ""; card.appendChild(renderStep()); }

  function renderStep() {
    if (state.step === 1) return renderStepName();
    if (state.step === 2) return renderStepRepos();
    return renderStepReview();
  }

  function header(title, subtitle) {
    return h("div", { class: "px-4 py-3 border-b border-neutral-800 flex items-center justify-between" }, [
      h("div", {}, [
        h("div", { class: "text-base font-semibold" }, [title]),
        subtitle ? h("div", { class: "text-xs text-neutral-500 mt-0.5" }, [subtitle]) : null,
      ]),
      h("div", { class: "text-xs text-neutral-500" }, [`step ${state.step} / 3`]),
    ]);
  }

  function footer(actions) {
    return h("div", { class: "px-4 py-3 border-t border-neutral-800 flex items-center justify-end gap-2" }, actions);
  }

  // ── Step 1 — project name ──────────────────────────────────────────────
  function renderStepName() {
    const nameEl = h("input", {
      type: "text",
      value: state.name,
      class: "w-full bg-neutral-950 border border-neutral-800 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700",
      placeholder: "myproject",
    });
    nameEl.addEventListener("input", () => { state.name = nameEl.value.trim(); });

    const next = btn("next →", {
      variant: "primary",
      onClick: () => {
        if (!state.name) { toast("error", "project name is required"); return; }
        if (!/^[A-Za-z0-9_.-]+$/.test(state.name)) {
          toast("error", "project name must match [A-Za-z0-9_.-]+");
          return;
        }
        state.step = 2;
        rerender();
      },
    });

    return h("div", { class: "flex flex-col" }, [
      header("New project", "Give your project a short, file-system-safe name."),
      h("div", { class: "p-4 space-y-3 overflow-y-auto" }, [
        h("label", { class: "block text-xs text-neutral-400 mb-1" }, ["Project name"]),
        nameEl,
        h("p", { class: "text-xs text-neutral-500" }, [
          "This is the identifier you'll use everywhere: ",
          h("code", { class: "text-neutral-300" }, [`bn ${state.name || "<name>"} start`]),
        ]),
      ]),
      footer([
        btn("cancel", { onClick: close }),
        next,
      ]),
    ]);
  }

  // ── Step 2 — repos ─────────────────────────────────────────────────────
  function renderStepRepos() {
    const list = h("div", { class: "space-y-2" }, state.repos.map((r, i) => renderRepoRow(r, i)));

    return h("div", { class: "flex flex-col min-h-0" }, [
      header(`Repos for '${state.name}'`, "Add the repos this project spans. Detect tech from the path."),
      h("div", { class: "p-4 space-y-3 overflow-y-auto" }, [
        list,
        h("div", { class: "flex justify-center" }, [
          btn("+ add repo", { onClick: () => openAddRepoDialog((repo) => {
            state.repos.push(repo);
            rerender();
          }) }),
        ]),
        state.repos.length === 0
          ? h("p", { class: "text-xs text-neutral-500 text-center" }, ["No repos yet — add at least one to continue."])
          : null,
      ]),
      footer([
        btn("← back", { onClick: () => { state.step = 1; rerender(); } }),
        btn("review →", {
          variant: "primary",
          onClick: () => {
            if (state.repos.length === 0) { toast("error", "add at least one repo"); return; }
            state.step = 3;
            rerender();
          },
        }),
      ]),
    ]);
  }

  function renderRepoRow(repo, idx) {
    const techLabel = profiles.find((p) => p.id === repo.tech)?.label ?? repo.tech ?? "—";
    return h("div", { class: "border border-neutral-800 rounded p-3 bg-neutral-950/50" }, [
      h("div", { class: "flex items-start justify-between gap-3" }, [
        h("div", { class: "min-w-0 flex-1" }, [
          h("div", { class: "flex items-center gap-2" }, [
            h("span", { class: "text-sm font-mono text-neutral-100" }, [repo.name]),
            pill(techLabel, "blue"),
          ]),
          h("div", { class: "text-xs text-neutral-500 mt-1 font-mono truncate" }, [repo.path]),
          repo.run?.command
            ? h("div", { class: "text-xs text-neutral-400 mt-1 font-mono truncate" }, ["$ " + repo.run.command])
            : null,
        ]),
        h("div", { class: "flex gap-1" }, [
          btn("edit", { onClick: () => openAddRepoDialog((updated) => {
            state.repos[idx] = updated;
            rerender();
          }, repo) }),
          btn("remove", { variant: "danger", onClick: () => {
            state.repos.splice(idx, 1);
            rerender();
          } }),
        ]),
      ]),
    ]);
  }

  // ── Step 3 — review + submit ───────────────────────────────────────────
  function renderStepReview() {
    const submit = btn("Create project", {
      variant: "primary",
      onClick: async () => {
        submit.disabled = true;
        const body = {
          name: state.name,
          repos: state.repos.map((r) => ({
            name: r.name,
            path: r.path,
            ...(r.baseBranch ? { baseBranch: r.baseBranch } : {}),
            ...(r.tech ? { tech: r.tech } : {}),
            ...(r.run?.command ? { run: r.run } : {}),
          })),
        };
        try {
          const r = await fetch("/api/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await r.json().catch(() => ({}));
          if (r.ok && data.ok) {
            toast("success", `project '${data.name}' created`);
            close();
            scheduleRefresh(true);
          } else {
            toast("error", "create failed", [data.error || `${r.status}`]);
            submit.disabled = false;
          }
        } catch (err) {
          toast("error", "create failed", [String(err)]);
          submit.disabled = false;
        }
      },
    });

    return h("div", { class: "flex flex-col min-h-0" }, [
      header("Review", "config.yaml will be updated. Comments and other projects are preserved."),
      h("div", { class: "p-4 space-y-3 overflow-y-auto" }, [
        h("div", { class: "text-xs text-neutral-400" }, ["Project"]),
        h("div", { class: "font-mono text-sm" }, [state.name]),
        h("div", { class: "text-xs text-neutral-400 mt-3" }, [`Repos (${state.repos.length})`]),
        ...state.repos.map((repo) => h("div", { class: "border border-neutral-800 rounded p-2 bg-neutral-950/50 text-xs" }, [
          h("div", { class: "flex items-center gap-2" }, [
            h("span", { class: "font-mono text-neutral-100" }, [repo.name]),
            pill(profiles.find((p) => p.id === repo.tech)?.label ?? "custom", "blue"),
          ]),
          h("div", { class: "text-neutral-500 font-mono mt-0.5" }, [repo.path]),
          repo.run?.command ? h("div", { class: "text-neutral-400 font-mono mt-0.5" }, ["$ " + repo.run.command]) : null,
        ])),
      ]),
      footer([
        btn("← back", { onClick: () => { state.step = 2; rerender(); } }),
        submit,
      ]),
    ]);
  }

  rerender();
}

// ── add-repo dialog (step 2 sub-flow) ─────────────────────────────────────
// Nested overlay (z-50 so it stacks above the wizard) that lets the user
// pick a path, name it, choose a tech profile, and optionally tweak the
// run command before adding the repo to the wizard's draft state.

async function openAddRepoDialog(onSubmit, initial) {
  const profiles = await (async () => {
    const r = await fetch("/api/tech-profiles").catch(() => null);
    if (!r || !r.ok) return [];
    const data = await r.json();
    return data.profiles ?? [];
  })();

  const draft = initial
    ? JSON.parse(JSON.stringify(initial))
    : { name: "", path: "", baseBranch: "", tech: "custom", run: { command: "", port: null, portEnv: "", setup: "", stopCommand: "" } };

  const overlay = h("div", {
    class: "fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4",
    onclick: (e) => { if (e.target === overlay) overlay.remove(); },
  });
  const card = h("div", {
    class: "bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-[min(95vw,40rem)] max-h-[90vh] flex flex-col",
  });
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function rerender() { card.innerHTML = ""; card.appendChild(renderBody()); }

  function renderBody() {
    const pathInput = h("input", {
      type: "text",
      value: draft.path,
      class: "flex-1 bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700",
      placeholder: "~/Documents/Dev/MyApp/Front",
    });
    pathInput.addEventListener("input", () => { draft.path = pathInput.value; });

    const browseBtn = btn("Browse…", {
      onClick: () => openFsBrowser((picked) => {
        draft.path = picked;
        pathInput.value = picked;
        if (!draft.name) {
          // Default repo name = basename — user can override after probe.
          draft.name = picked.split("/").filter(Boolean).pop() ?? "";
        }
        runProbe();
      }),
    });

    const probeBtn = btn("Detect", { onClick: runProbe });

    const nameInput = h("input", {
      type: "text",
      value: draft.name,
      class: "w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700",
      placeholder: "front, back, app, …",
    });
    nameInput.addEventListener("input", () => { draft.name = nameInput.value.trim(); });

    const techSelect = h("select", {
      class: "w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm",
    }, profiles.map((p) =>
      h("option", { value: p.id, ...(p.id === draft.tech ? { selected: "selected" } : {}) }, [`${p.label} — ${p.hint}`]),
    ));
    techSelect.addEventListener("change", () => {
      draft.tech = techSelect.value;
      // Re-apply defaults from the new profile, but only overwrite empty
      // fields so we don't clobber a custom command the user just typed.
      const profile = profiles.find((p) => p.id === draft.tech);
      if (profile) applyProfileDefaults(draft, profile, { overwrite: true });
      rerender();
    });

    const baseInput = h("input", {
      type: "text",
      value: draft.baseBranch,
      class: "w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700",
      placeholder: "main, develop, …",
    });
    baseInput.addEventListener("input", () => { draft.baseBranch = baseInput.value.trim(); });

    const commandInput = h("input", {
      type: "text",
      value: draft.run.command,
      class: "w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700",
      placeholder: "npm run dev",
    });
    commandInput.addEventListener("input", () => { draft.run.command = commandInput.value; });

    const portInput = h("input", {
      type: "number",
      value: draft.run.port ?? "",
      class: "w-24 bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700",
      placeholder: "3000",
    });
    portInput.addEventListener("input", () => {
      const n = parseInt(portInput.value, 10);
      draft.run.port = Number.isFinite(n) ? n : null;
    });

    const portEnvInput = h("input", {
      type: "text",
      value: draft.run.portEnv,
      class: "flex-1 bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700",
      placeholder: "PORT, SERVER_PORT, …",
    });
    portEnvInput.addEventListener("input", () => { draft.run.portEnv = portEnvInput.value.trim(); });

    const stopInput = h("input", {
      type: "text",
      value: draft.run.stopCommand,
      class: "w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-700",
      placeholder: "(optional) ./gradlew --stop",
    });
    stopInput.addEventListener("input", () => { draft.run.stopCommand = stopInput.value.trim(); });

    async function runProbe() {
      const target = draft.path.trim();
      if (!target) return;
      try {
        const r = await fetch("/api/fs/probe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: target }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          toast("error", "probe failed", [data.error || `${r.status}`]);
          return;
        }
        if (!data.valid) {
          toast("error", "invalid path", [data.error || "path rejected"]);
          return;
        }
        // Normalize the path so what we persist matches what the server accepted.
        draft.path = data.path;
        if (!draft.name) draft.name = data.suggestedName;
        if (data.suggestedTech) draft.tech = data.suggestedTech;
        const profile = profiles.find((p) => p.id === draft.tech);
        // When the probe filled run defaults, prefer those (richer than the
        // generic profile defaults — they may include the actual app id, etc).
        if (data.suggestedRun) {
          draft.run = { ...draft.run, ...data.suggestedRun };
        } else if (profile) {
          applyProfileDefaults(draft, profile, { overwrite: true });
        }
        toast("info", "detected", [data.stackLabel || "tech: " + (draft.tech || "custom")]);
        rerender();
      } catch (err) {
        toast("error", "probe failed", [String(err)]);
      }
    }

    const submit = btn(initial ? "Save" : "Add repo", {
      variant: "primary",
      onClick: () => {
        if (!draft.name) { toast("error", "repo name is required"); return; }
        if (!draft.path) { toast("error", "repo path is required"); return; }
        if (draft.tech !== "custom" && !draft.run.command) {
          // Profile defaults should have filled this — but guard anyway.
          toast("error", "run command is empty");
          return;
        }
        // Strip empties before handing off so the wizard state stays clean.
        const out = {
          name: draft.name,
          path: draft.path,
          ...(draft.baseBranch ? { baseBranch: draft.baseBranch } : {}),
          tech: draft.tech,
          run: draft.run.command ? {
            command: draft.run.command,
            ...(draft.run.port ? { port: draft.run.port } : {}),
            ...(draft.run.portEnv ? { portEnv: draft.run.portEnv } : {}),
            ...(draft.run.setup ? { setup: draft.run.setup } : {}),
            ...(draft.run.stopCommand ? { stopCommand: draft.run.stopCommand } : {}),
          } : null,
        };
        overlay.remove();
        onSubmit(out);
      },
    });

    return h("div", { class: "flex flex-col min-h-0" }, [
      h("div", { class: "px-4 py-3 border-b border-neutral-800" }, [
        h("div", { class: "text-base font-semibold" }, [initial ? "Edit repo" : "Add repo"]),
      ]),
      h("div", { class: "p-4 space-y-3 overflow-y-auto" }, [
        h("div", {}, [
          h("label", { class: "block text-xs text-neutral-400 mb-1" }, ["Path"]),
          h("div", { class: "flex gap-2" }, [pathInput, browseBtn, probeBtn]),
          h("p", { class: "text-xs text-neutral-500 mt-1" }, ["Pick a directory and detect, or type the path manually."]),
        ]),
        h("div", {}, [
          h("label", { class: "block text-xs text-neutral-400 mb-1" }, ["Repo name"]),
          nameInput,
        ]),
        h("div", {}, [
          h("label", { class: "block text-xs text-neutral-400 mb-1" }, ["Tech"]),
          techSelect,
        ]),
        h("div", {}, [
          h("label", { class: "block text-xs text-neutral-400 mb-1" }, ["Base branch (optional)"]),
          baseInput,
        ]),
        h("div", { class: "pt-2 border-t border-neutral-800" }, [
          h("label", { class: "block text-xs text-neutral-400 mb-1" }, ["Run command"]),
          commandInput,
        ]),
        h("div", { class: "flex gap-2" }, [
          h("div", { class: "flex-shrink-0" }, [
            h("label", { class: "block text-xs text-neutral-400 mb-1" }, ["Port"]),
            portInput,
          ]),
          h("div", { class: "flex-1" }, [
            h("label", { class: "block text-xs text-neutral-400 mb-1" }, ["Port env"]),
            portEnvInput,
          ]),
        ]),
        h("div", {}, [
          h("label", { class: "block text-xs text-neutral-400 mb-1" }, ["Stop command (optional)"]),
          stopInput,
        ]),
      ]),
      h("div", { class: "px-4 py-3 border-t border-neutral-800 flex items-center justify-end gap-2" }, [
        btn("cancel", { onClick: () => overlay.remove() }),
        submit,
      ]),
    ]);
  }

  rerender();
}

function applyProfileDefaults(draft, profile, { overwrite }) {
  const d = profile.defaults || {};
  if (overwrite || !draft.run.command) draft.run.command = d.command ?? "";
  if (overwrite || draft.run.port == null) draft.run.port = d.port ?? null;
  if (overwrite || !draft.run.portEnv) draft.run.portEnv = d.portEnv ?? "";
  if (overwrite || !draft.run.setup) draft.run.setup = d.setup ?? "";
  if (overwrite || !draft.run.stopCommand) draft.run.stopCommand = d.stopCommand ?? "";
}

// ── filesystem browser modal ──────────────────────────────────────────────
async function openFsBrowser(onPick) {
  const overlay = h("div", {
    class: "fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4",
    onclick: (e) => { if (e.target === overlay) overlay.remove(); },
  });
  const card = h("div", {
    class: "bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl w-[min(95vw,38rem)] max-h-[85vh] flex flex-col",
  });
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let currentPath = null; // server-canonicalised after the first fetch

  async function fetchAndRender(targetPath) {
    card.innerHTML = "";
    card.appendChild(h("div", { class: "px-4 py-3 border-b border-neutral-800 text-base font-semibold" }, ["Pick a directory"]));
    const body = h("div", { class: "p-4 space-y-2 overflow-y-auto flex-1" });
    card.appendChild(body);

    body.appendChild(h("p", { class: "text-xs text-neutral-500" }, ["loading…"]));
    let data;
    try {
      const url = "/api/fs/list" + (targetPath ? "?path=" + encodeURIComponent(targetPath) : "");
      const r = await fetch(url);
      data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `${r.status}`);
    } catch (err) {
      body.innerHTML = "";
      body.appendChild(h("p", { class: "text-rose-400 text-sm" }, [String(err)]));
      return;
    }

    currentPath = data.path;
    body.innerHTML = "";

    body.appendChild(h("div", { class: "text-xs text-neutral-400 font-mono break-all" }, [currentPath]));

    if (data.parent) {
      body.appendChild(rowEl("..", "go up", () => fetchAndRender(data.parent)));
    }

    if (data.entries.length === 0) {
      body.appendChild(h("p", { class: "text-xs text-neutral-500 italic" }, ["(empty)"]));
    } else {
      for (const entry of data.entries) {
        body.appendChild(rowEl(
          entry.name,
          entry.isGitRepo ? "git repo" : "",
          () => fetchAndRender(currentPath + "/" + entry.name),
        ));
      }
    }

    card.appendChild(h("div", { class: "px-4 py-3 border-t border-neutral-800 flex items-center justify-end gap-2" }, [
      btn("cancel", { onClick: () => overlay.remove() }),
      btn("pick this folder", {
        variant: "primary",
        onClick: () => {
          if (currentPath) {
            overlay.remove();
            onPick(currentPath);
          }
        },
      }),
    ]));
  }

  function rowEl(name, badge, onClick) {
    return h("button", {
      class: "w-full text-left flex items-center justify-between px-3 py-2 rounded hover:bg-neutral-800 text-sm font-mono",
      onclick: onClick,
    }, [
      h("span", { class: "text-neutral-200" }, [name]),
      badge ? h("span", { class: "text-xs text-emerald-400" }, [badge]) : null,
    ]);
  }

  fetchAndRender(null);
}

// Add a "+ new project" button next to the project selector so users can
// reach the wizard from anywhere, not just the empty state.
(function installSelectorCta() {
  const headerLeft = document.querySelector("header .flex.items-center.gap-3");
  if (!headerLeft) return;
  const button = h("button", {
    class: "px-2 py-1 text-xs rounded ring-1 transition font-medium bg-sky-900 hover:bg-sky-800 text-sky-100 ring-sky-700",
    title: "Create a new project",
    onclick: openNewProjectWizard,
  }, ["+ new project"]);
  headerLeft.appendChild(button);
})();
