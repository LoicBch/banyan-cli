/**
 * Integrations scheduler — runs every configured source on its own cadence and
 * funnels matching tasks into the inbox. Started by the dashboard server on
 * `bn serve`; can also be triggered on-demand via `runOnce()` (the "poll now"
 * button + `bn integrations poll` CLI).
 *
 * Two thin layers between the source and the inbox:
 *   - matchRules — applies the user's IntegrationRule filters (AND semantics)
 *   - upsertPull — dedupes against what banyan already knows
 *
 * The scheduler is intentionally forgiving: a misconfigured source logs an
 * error and is skipped, never crashes the dashboard.
 */
import { buildClickUpSource } from "./providers/clickup.js";
import { upsertPull } from "./inbox.js";
import type {
  IntegrationsConfig,
  IntegrationRule,
  SourceConfig,
  Task,
  TaskSource,
} from "./types.js";

interface BuiltSource {
  cfg: SourceConfig;
  source: TaskSource;
  /** Rules that apply to this source. Empty = let everything through. */
  rules: IntegrationRule[];
  /** ms epoch of the last successful pull, for cadence enforcement. */
  lastPullAt: number;
}

export class IntegrationsScheduler {
  private built: BuiltSource[] = [];
  private timer?: NodeJS.Timeout;
  private readonly tickMs: number;
  private running = false;

  constructor(cfg: IntegrationsConfig, tickIntervalMs = 60_000) {
    this.tickMs = tickIntervalMs;
    this.built = buildSources(cfg);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Kick once immediately so the inbox has fresh data on dashboard load.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Rebuild the source list from a fresh config (after the user edited it
   *  in the dashboard). Preserves the running ticker — only the sources
   *  list and per-source rule sets are swapped. */
  reload(cfg: IntegrationsConfig): void {
    this.built = buildSources(cfg);
  }

  /** Force a pull of all sources right now, ignoring their pollIntervalMin. */
  async runOnce(): Promise<{ added: number; refreshed: number; errors: Array<{ source: string; error: string }> }> {
    let added = 0;
    let refreshed = 0;
    const errors: Array<{ source: string; error: string }> = [];
    for (const b of this.built) {
      try {
        const r = await pullOne(b);
        added += r.added;
        refreshed += r.refreshed;
        b.lastPullAt = Date.now();
      } catch (err) {
        errors.push({ source: b.source.name, error: (err as Error).message });
      }
    }
    return { added, refreshed, errors };
  }

  /** Internal tick — only pulls sources whose cadence has elapsed. */
  private async tick(): Promise<void> {
    const now = Date.now();
    for (const b of this.built) {
      const due = now - b.lastPullAt >= b.source.pollIntervalMin * 60_000;
      if (!due) continue;
      try {
        await pullOne(b);
        b.lastPullAt = now;
      } catch (err) {
        // Don't crash the loop on a single bad source.
        console.error(`[integrations/${b.source.name}]`, (err as Error).message);
      }
    }
  }

  get sourceCount(): number {
    return this.built.length;
  }
}

function buildSources(cfg: IntegrationsConfig): BuiltSource[] {
  const out: BuiltSource[] = [];
  for (const sc of cfg.sources) {
    let source: TaskSource;
    try {
      if (sc.type === "clickup") source = buildClickUpSource(sc);
      else {
        console.error(`[integrations] unknown source type '${sc.type}' for '${sc.name}'`);
        continue;
      }
    } catch (err) {
      console.error(`[integrations/${sc.name}] config error: ${(err as Error).message}`);
      continue;
    }
    const rules = cfg.rules.filter((r) => r.source === sc.name);
    out.push({ cfg: sc, source, rules, lastPullAt: 0 });
  }
  return out;
}

async function pullOne(b: BuiltSource): Promise<{ added: number; refreshed: number }> {
  const raw = await b.source.pull();
  // Apply rules (filter + carry suggestions). If multiple rules match, the
  // first match wins for the suggestion (rules are evaluated in order).
  const matched: Array<{ task: Task; suggest: { project?: string; mode?: string } }> = [];
  for (const t of raw) {
    if (b.rules.length === 0) {
      // No rules → let everything through with no suggestion.
      matched.push({ task: t, suggest: {} });
      continue;
    }
    let firstMatch: IntegrationRule | undefined;
    for (const rule of b.rules) {
      if (taskMatches(t, rule)) { firstMatch = rule; break; }
    }
    if (firstMatch) {
      matched.push({
        task: t,
        suggest: {
          project: firstMatch.suggest.project,
          ...(firstMatch.suggest.mode ? { mode: firstMatch.suggest.mode } : {}),
        },
      });
    }
  }

  let added = 0;
  let refreshed = 0;
  // Group by suggestion so upsertPull can carry the per-rule project/mode.
  // (upsertPull takes one suggest payload per call.)
  const groups = new Map<string, { tasks: Task[]; suggest: { project?: string; mode?: string } }>();
  for (const m of matched) {
    const key = `${m.suggest.project ?? ""}|${m.suggest.mode ?? ""}`;
    let g = groups.get(key);
    if (!g) {
      g = { tasks: [], suggest: m.suggest };
      groups.set(key, g);
    }
    g.tasks.push(m.task);
  }
  for (const g of groups.values()) {
    const r = upsertPull(b.source.name, g.tasks, g.suggest);
    added += r.added;
    refreshed += r.refreshed;
  }
  return { added, refreshed };
}

function taskMatches(t: Task, rule: IntegrationRule): boolean {
  const w = rule.when;
  if (!w) return true;
  if (w.assigneesAny && w.assigneesAny.length > 0) {
    const set = new Set(w.assigneesAny.map((s) => s.toLowerCase()));
    if (!t.assignees.some((a) => set.has(a.toLowerCase()))) return false;
  }
  if (w.statusesAny && w.statusesAny.length > 0) {
    const set = new Set(w.statusesAny.map((s) => s.toLowerCase()));
    if (!t.status || !set.has(t.status.toLowerCase())) return false;
  }
  if (w.tagsAny && w.tagsAny.length > 0) {
    const set = new Set(w.tagsAny.map((s) => s.toLowerCase()));
    if (!(t.tags ?? []).some((tag) => set.has(tag.toLowerCase()))) return false;
  }
  return true;
}
