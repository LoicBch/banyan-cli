/**
 * Per-feature TODO list ops — what the agent maintains during a task.
 *
 * `setFeatureTodo` replaces the list wholesale. `updateFeatureTodo` does
 * fine-grained ops (add/done/undone/remove) and returns the resulting
 * state. The validation/storage primitives live in `../../todo.ts`.
 */
import {
  setTodo,
  addTodoItems,
  markTodoDone,
  markTodoUndone,
  removeTodoItems,
  getTodo,
  type FeatureTodo,
} from "../../todo.js";
import { UsageError } from "../../errors.js";
import { validateProject } from "./shared.js";

export async function setFeatureTodo(
  projectName: string,
  feature: string,
  items: string[],
): Promise<{ ok: true; todo: FeatureTodo }> {
  await validateProject(projectName);
  const todo = setTodo(projectName, feature, items);
  return { ok: true, todo };
}

export async function getFeatureTodo(
  projectName: string,
  feature: string,
): Promise<{ todo: FeatureTodo | null }> {
  await validateProject(projectName);
  return { todo: getTodo(projectName, feature) ?? null };
}

export async function updateFeatureTodo(
  projectName: string,
  feature: string,
  ops: {
    add?: string[];
    done?: string[];
    undone?: string[];
    remove?: string[];
  },
): Promise<{ ok: true; todo: FeatureTodo }> {
  await validateProject(projectName);
  let todo: FeatureTodo | undefined;
  if (ops.add && ops.add.length > 0) todo = addTodoItems(projectName, feature, ops.add);
  if (ops.done && ops.done.length > 0) todo = markTodoDone(projectName, feature, ops.done);
  if (ops.undone && ops.undone.length > 0) todo = markTodoUndone(projectName, feature, ops.undone);
  if (ops.remove && ops.remove.length > 0) todo = removeTodoItems(projectName, feature, ops.remove);
  if (!todo) {
    const cur = getTodo(projectName, feature);
    if (!cur) throw new UsageError(`no todo for ${projectName}/${feature} and no ops applied`);
    todo = cur;
  }
  return { ok: true, todo };
}
