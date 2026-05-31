/**
 * Per-feature TODO lists, owned by banyan and exposed to per-feature agents
 * via MCP. The list defines what "task complete" means for autopilot mode,
 * and gives the dashboard structured progress to render.
 *
 * Layout: ~/.config/banyan/state/<project>.<feature>.todo.json
 *
 * Mutable JSON (not append-only) — items can be marked done/undone, added,
 * removed. ID assignment is monotonic per feature: removed IDs are never
 * reused, so external references stay stable.
 *
 * The agent typically calls `banyan_set_todo` once at the start of a task
 * to lay out its plan, then `banyan_update_todo` as it progresses. Humans
 * can also tweak the list via `bn <project> todo <feature>`.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const STATE_DIR = path.join(homedir(), ".config", "banyan", "state");

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  /** ISO timestamp when marked done. null when not done. */
  doneAt: string | null;
}

export interface FeatureTodo {
  project: string;
  feature: string;
  items: TodoItem[];
  /** Monotonic ID counter — next ID = String(nextId). Persisted so removed
   *  IDs are never reused even after restart. */
  nextId: number;
  createdAt: string;
  updatedAt: string;
}

function todoPath(project: string, feature: string): string {
  return path.join(STATE_DIR, `${project}.${feature}.todo.json`);
}

function nowISO(): string {
  return new Date().toISOString();
}

function emptyTodo(project: string, feature: string): FeatureTodo {
  const now = nowISO();
  return { project, feature, items: [], nextId: 1, createdAt: now, updatedAt: now };
}

export function getTodo(project: string, feature: string): FeatureTodo | undefined {
  const p = todoPath(project, feature);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as FeatureTodo;
  } catch {
    return undefined;
  }
}

function saveTodo(todo: FeatureTodo): FeatureTodo {
  mkdirSync(STATE_DIR, { recursive: true });
  todo.updatedAt = nowISO();
  writeFileSync(todoPath(todo.project, todo.feature), JSON.stringify(todo, null, 2), "utf8");
  return todo;
}

/** Replace the whole list with a fresh set of items. Resets ID counter to
 *  start at 1 (this is a fresh plan, not an edit). */
export function setTodo(
  project: string,
  feature: string,
  items: string[],
): FeatureTodo {
  const now = nowISO();
  const existing = getTodo(project, feature);
  const todo: FeatureTodo = {
    project,
    feature,
    items: items.map((text, i) => ({
      id: String(i + 1),
      text,
      done: false,
      doneAt: null,
    })),
    nextId: items.length + 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return saveTodo(todo);
}

/** Append items to an existing list (or create one). Allocates IDs from
 *  `nextId`, increments. */
export function addTodoItems(
  project: string,
  feature: string,
  items: string[],
): FeatureTodo {
  const todo = getTodo(project, feature) ?? emptyTodo(project, feature);
  for (const text of items) {
    todo.items.push({
      id: String(todo.nextId),
      text,
      done: false,
      doneAt: null,
    });
    todo.nextId++;
  }
  return saveTodo(todo);
}

export function markTodoDone(
  project: string,
  feature: string,
  ids: string[],
): FeatureTodo {
  const todo = getTodo(project, feature);
  if (!todo) throw new Error(`no todo for ${project}/${feature}`);
  const set = new Set(ids);
  const now = nowISO();
  for (const it of todo.items) {
    if (set.has(it.id) && !it.done) {
      it.done = true;
      it.doneAt = now;
    }
  }
  return saveTodo(todo);
}

export function markTodoUndone(
  project: string,
  feature: string,
  ids: string[],
): FeatureTodo {
  const todo = getTodo(project, feature);
  if (!todo) throw new Error(`no todo for ${project}/${feature}`);
  const set = new Set(ids);
  for (const it of todo.items) {
    if (set.has(it.id) && it.done) {
      it.done = false;
      it.doneAt = null;
    }
  }
  return saveTodo(todo);
}

export function removeTodoItems(
  project: string,
  feature: string,
  ids: string[],
): FeatureTodo {
  const todo = getTodo(project, feature);
  if (!todo) throw new Error(`no todo for ${project}/${feature}`);
  const set = new Set(ids);
  todo.items = todo.items.filter((it) => !set.has(it.id));
  return saveTodo(todo);
}

export function deleteTodo(project: string, feature: string): void {
  const p = todoPath(project, feature);
  if (existsSync(p)) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

/** List all features that have a TODO recorded for a project. */
export function listTodoFeatures(project: string): FeatureTodo[] {
  if (!existsSync(STATE_DIR)) return [];
  const prefix = `${project}.`;
  const suffix = ".todo.json";
  const out: FeatureTodo[] = [];
  for (const f of readdirSync(STATE_DIR)) {
    if (!f.startsWith(prefix) || !f.endsWith(suffix)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path.join(STATE_DIR, f), "utf8")) as FeatureTodo;
      out.push(parsed);
    } catch {
      // skip
    }
  }
  return out;
}

/** Convenience: are all items in the TODO marked done? */
export function isTodoComplete(todo: FeatureTodo): boolean {
  return todo.items.length > 0 && todo.items.every((it) => it.done);
}
