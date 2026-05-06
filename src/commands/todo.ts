import { logger } from "../logger.js";
import {
  setTodo,
  addTodoItems,
  markTodoDone,
  markTodoUndone,
  removeTodoItems,
  getTodo,
  type FeatureTodo,
} from "../todo.js";
import { UsageError } from "../errors.js";

export interface TodoCmdOpts {
  /** Append items to the list. */
  add?: string[];
  /** Replace the whole list. */
  set?: string[];
  /** Mark these item ids as done. */
  done?: string[];
  /** Mark these item ids as not done. */
  undone?: string[];
  /** Remove these item ids. */
  rm?: string[];
  /** Emit JSON instead of a formatted view. */
  json?: boolean;
}

export async function todoCmd(
  projectName: string,
  feature: string,
  opts: TodoCmdOpts = {},
): Promise<void> {
  let todo: FeatureTodo | undefined;
  let mutated = false;

  if (opts.set && opts.set.length > 0) {
    todo = setTodo(projectName, feature, opts.set);
    mutated = true;
  }
  if (opts.add && opts.add.length > 0) {
    todo = addTodoItems(projectName, feature, opts.add);
    mutated = true;
  }
  if (opts.done && opts.done.length > 0) {
    todo = markTodoDone(projectName, feature, opts.done);
    mutated = true;
  }
  if (opts.undone && opts.undone.length > 0) {
    todo = markTodoUndone(projectName, feature, opts.undone);
    mutated = true;
  }
  if (opts.rm && opts.rm.length > 0) {
    todo = removeTodoItems(projectName, feature, opts.rm);
    mutated = true;
  }

  if (!mutated) {
    todo = getTodo(projectName, feature);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(todo ?? null, null, 2) + "\n");
    return;
  }

  if (!todo) {
    if (mutated) throw new UsageError(`no todo for ${projectName}/${feature}`);
    logger.info(
      `no TODO for ${projectName}/${feature}. create with: bn ${projectName} todo ${feature} --set "step 1" "step 2"`,
    );
    return;
  }

  printTodo(todo);
}

function printTodo(todo: FeatureTodo): void {
  const total = todo.items.length;
  const doneCount = todo.items.filter((it) => it.done).length;
  logger.info(``);
  logger.info(`── ${todo.project}/${todo.feature}  ${doneCount}/${total} done ──`);
  if (total === 0) {
    logger.info(`(empty list)`);
    return;
  }
  for (const it of todo.items) {
    const mark = it.done ? "[x]" : "[ ]";
    logger.info(`  ${mark} ${it.id}. ${it.text}`);
  }
}
