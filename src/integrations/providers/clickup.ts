/**
 * ClickUp adapter for the integrations layer.
 *
 * API: https://clickup.com/api/clickupreference/operation/GetTasks/
 * Endpoint: GET /api/v2/list/{list_id}/task
 * Auth: `Authorization: <Personal API Token>` (no "Bearer" prefix).
 *
 * We poll a single list at a time — keeps the polling fast and the scope
 * predictable. If you want multiple lists, declare multiple sources.
 *
 * Tasks are returned with assignees as objects; we normalise to email when
 * present (more stable than usernames), falling back to id otherwise.
 */
import type { Task, TaskSource, SourceConfig } from "../types.js";

const CLICKUP_API = "https://api.clickup.com/api/v2";

interface ClickUpOptions {
  apiToken: string;
  listId: string;
  /** Include closed tasks too. Default false (closed tasks aren't actionable). */
  includeClosed?: boolean;
}

function parseOptions(raw: Record<string, unknown>, sourceName: string): ClickUpOptions {
  const apiToken = typeof raw.apiToken === "string" ? raw.apiToken : "";
  const listIdRaw = raw.listId;
  const listId = typeof listIdRaw === "string"
    ? listIdRaw
    : typeof listIdRaw === "number"
    ? String(listIdRaw)
    : "";
  if (!apiToken) throw new Error(`source "${sourceName}": clickup.options.apiToken is required`);
  if (!listId) throw new Error(`source "${sourceName}": clickup.options.listId is required`);
  return {
    apiToken,
    listId,
    includeClosed: Boolean(raw.includeClosed),
  };
}

export function buildClickUpSource(cfg: SourceConfig): TaskSource {
  const opts = parseOptions(cfg.options, cfg.name);
  const pollIntervalMin = cfg.pollIntervalMin ?? 5;
  return {
    name: cfg.name,
    type: "clickup",
    pollIntervalMin,
    pull: () => pullList(cfg.name, opts),
  };
}

interface ClickUpAssignee {
  id?: number;
  username?: string;
  email?: string;
}

interface ClickUpTask {
  id: string;
  name: string;
  description?: string;
  text_content?: string;
  status?: { status?: string; type?: string };
  assignees?: ClickUpAssignee[];
  tags?: Array<{ name?: string }>;
  url?: string;
  date_created?: string;
  date_updated?: string;
}

async function pullList(sourceName: string, opts: ClickUpOptions): Promise<Task[]> {
  const url = new URL(`${CLICKUP_API}/list/${encodeURIComponent(opts.listId)}/task`);
  url.searchParams.set("page", "0");
  if (!opts.includeClosed) url.searchParams.set("archived", "false");
  else url.searchParams.set("subtasks", "true");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: opts.apiToken, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Transient network failures — don't throw, just yield an empty set.
    console.error(`[integrations/${sourceName}] network error:`, (err as Error).message);
    return [];
  }
  if (!res.ok) {
    // Bad config (401 invalid token, 404 missing list) should be visible.
    const body = await res.text().catch(() => "");
    throw new Error(`ClickUp GET /list/${opts.listId}/task → ${res.status} ${body.slice(0, 200)}`);
  }
  let payload: { tasks?: ClickUpTask[] };
  try {
    payload = (await res.json()) as { tasks?: ClickUpTask[] };
  } catch {
    return [];
  }
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  return tasks.map((raw) => normalise(sourceName, raw));
}

function normalise(sourceName: string, raw: ClickUpTask): Task {
  const assignees: string[] = [];
  for (const a of raw.assignees ?? []) {
    // Prefer email — most stable + matches what users write in rules.
    if (a.email) assignees.push(a.email);
    else if (a.username) assignees.push(a.username);
    else if (a.id !== undefined) assignees.push(`id:${a.id}`);
  }
  const tags = (raw.tags ?? [])
    .map((t) => t.name)
    .filter((n): n is string => typeof n === "string");
  const createdAt = isoFromMs(raw.date_created);
  const updatedAt = isoFromMs(raw.date_updated);
  return {
    id: `${sourceName}:${raw.id}`,
    source: sourceName,
    externalId: raw.id,
    title: raw.name || "(no title)",
    description: raw.text_content || raw.description || "",
    assignees,
    status: raw.status?.status,
    url: raw.url,
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    raw,
  };
}

function isoFromMs(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return new Date(n).toISOString();
}
