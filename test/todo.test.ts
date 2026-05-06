import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let originalHome: string | undefined;
let tmpHome: string;

before(() => {
  originalHome = process.env.HOME;
  tmpHome = mkdtempSync(path.join(tmpdir(), "banyan-todo-test-"));
  process.env.HOME = tmpHome;
});

after(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

const mod = await import("../src/todo.js");
const {
  setTodo,
  addTodoItems,
  markTodoDone,
  markTodoUndone,
  removeTodoItems,
  getTodo,
  deleteTodo,
  listTodoFeatures,
  isTodoComplete,
} = mod;

const STATE_DIR = path.join(tmpHome!, ".config", "banyan", "state");

describe("todo", () => {
  beforeEach(() => {
    if (existsSync(STATE_DIR)) {
      rmSync(STATE_DIR, { recursive: true, force: true });
    }
  });

  it("setTodo creates a fresh list with ids 1..N", () => {
    const todo = setTodo("p", "f", ["a", "b", "c"]);
    assert.equal(todo.items.length, 3);
    assert.deepEqual(todo.items.map((it) => it.id), ["1", "2", "3"]);
    assert.deepEqual(todo.items.map((it) => it.text), ["a", "b", "c"]);
    assert.ok(todo.items.every((it) => !it.done));
    assert.equal(todo.nextId, 4);
  });

  it("getTodo returns undefined when none exists", () => {
    assert.equal(getTodo("p", "ghost"), undefined);
  });

  it("addTodoItems appends without resetting ids", () => {
    setTodo("p", "f", ["a", "b"]);
    const todo = addTodoItems("p", "f", ["c", "d"]);
    assert.deepEqual(todo.items.map((it) => it.id), ["1", "2", "3", "4"]);
    assert.equal(todo.nextId, 5);
  });

  it("markTodoDone sets done=true and stamps doneAt", () => {
    setTodo("p", "f", ["a", "b", "c"]);
    const todo = markTodoDone("p", "f", ["1", "3"]);
    assert.equal(todo.items[0]!.done, true);
    assert.ok(todo.items[0]!.doneAt);
    assert.equal(todo.items[1]!.done, false);
    assert.equal(todo.items[2]!.done, true);
  });

  it("markTodoUndone reverts the done flag", () => {
    setTodo("p", "f", ["a", "b"]);
    markTodoDone("p", "f", ["1", "2"]);
    const todo = markTodoUndone("p", "f", ["1"]);
    assert.equal(todo.items[0]!.done, false);
    assert.equal(todo.items[0]!.doneAt, null);
    assert.equal(todo.items[1]!.done, true);
  });

  it("removeTodoItems drops items but keeps ids stable for the rest", () => {
    setTodo("p", "f", ["a", "b", "c"]);
    const todo = removeTodoItems("p", "f", ["2"]);
    assert.deepEqual(todo.items.map((it) => it.id), ["1", "3"]);
    assert.deepEqual(todo.items.map((it) => it.text), ["a", "c"]);
  });

  it("removed ids are NEVER reused (monotonic counter)", () => {
    setTodo("p", "f", ["a", "b"]);
    removeTodoItems("p", "f", ["1", "2"]);
    const todo = addTodoItems("p", "f", ["c"]);
    assert.equal(todo.items[0]!.id, "3"); // not "1"
  });

  it("setTodo resets the id counter", () => {
    setTodo("p", "f", ["a", "b"]);
    addTodoItems("p", "f", ["c"]);
    const todo = setTodo("p", "f", ["fresh1", "fresh2"]);
    assert.deepEqual(todo.items.map((it) => it.id), ["1", "2"]);
    assert.equal(todo.nextId, 3);
  });

  it("setTodo preserves createdAt across resets", async () => {
    const t1 = setTodo("p", "f", ["a"]);
    await new Promise((r) => setTimeout(r, 5));
    const t2 = setTodo("p", "f", ["b"]);
    assert.equal(t2.createdAt, t1.createdAt);
    assert.notEqual(t2.updatedAt, t1.updatedAt);
  });

  it("isTodoComplete returns true only when all items are done", () => {
    const todo = setTodo("p", "f", ["a", "b"]);
    assert.equal(isTodoComplete(todo), false);
    const after = markTodoDone("p", "f", ["1", "2"]);
    assert.equal(isTodoComplete(after), true);
  });

  it("isTodoComplete returns false on an empty list", () => {
    const todo = setTodo("p", "f", []);
    assert.equal(isTodoComplete(todo), false);
  });

  it("scopes per (project, feature) pair", () => {
    setTodo("alpha", "x", ["a"]);
    setTodo("beta", "x", ["b"]);
    setTodo("alpha", "y", ["c"]);
    assert.equal(getTodo("alpha", "x")!.items[0]!.text, "a");
    assert.equal(getTodo("beta", "x")!.items[0]!.text, "b");
    assert.equal(getTodo("alpha", "y")!.items[0]!.text, "c");
  });

  it("listTodoFeatures returns all todos for a project", () => {
    setTodo("alpha", "x", ["1"]);
    setTodo("alpha", "y", ["2"]);
    setTodo("beta", "x", ["3"]);
    const alpha = listTodoFeatures("alpha");
    assert.equal(alpha.length, 2);
    assert.deepEqual(alpha.map((t) => t.feature).sort(), ["x", "y"]);
    assert.equal(listTodoFeatures("beta").length, 1);
    assert.equal(listTodoFeatures("absent").length, 0);
  });

  it("deleteTodo removes the file", () => {
    setTodo("p", "f", ["a"]);
    assert.ok(getTodo("p", "f"));
    deleteTodo("p", "f");
    assert.equal(getTodo("p", "f"), undefined);
  });

  it("markTodoDone throws on non-existent feature", () => {
    assert.throws(() => markTodoDone("p", "ghost", ["1"]), /no todo/);
  });
});
