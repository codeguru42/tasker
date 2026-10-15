import { describe, expect, it } from "vitest";
import { orderTodos, todoOrder } from "../../src/plan/todo-order.js";
import { planTodo } from "../helpers/plan.js";

type Todo = ReturnType<typeof planTodo>;

function order(todos: Todo[]): string[] {
  return orderTodos(todos).map((todo) => todo.id);
}

function problemsOf(todos: Todo[]): string[] {
  const result = todoOrder(todos);
  return result.ok ? [] : result.problems;
}

describe("orderTodos", () => {
  it("puts a dependency before the todo that needs it", () => {
    expect(order([planTodo("a", ["b"]), planTodo("b")])).toEqual(["b", "a"]);
  });

  it("keeps the plan order among the ready todos", () => {
    expect(order([planTodo("a"), planTodo("b", ["a"]), planTodo("c")])).toEqual(["a", "b", "c"]);
    expect(order([planTodo("c", ["b"]), planTodo("a"), planTodo("b")])).toEqual(["a", "b", "c"]);
  });

  it("throws for a cycle, with its ids in plan order, and does not name a todo that only depends on it", () => {
    const todos = [planTodo("a"), planTodo("b", ["c"]), planTodo("c", ["b"]), planTodo("d", ["b"])];

    expect(() => orderTodos(todos)).toThrow(new Error("todos: a dependency cycle between b, c"));
  });

  it("throws for a todo that depends on itself", () => {
    expect(() => orderTodos([planTodo("a", ["a"])])).toThrow(new Error("todos: a dependency cycle between a"));
  });

  it("does not let an unknown dependency hold a todo back", () => {
    expect(order([planTodo("a", ["nope"]), planTodo("b")])).toEqual(["a", "b"]);
  });
});

describe("todoOrder", () => {
  it("gives the ordered todos when there is no cycle", () => {
    const todos = [planTodo("a", ["b"]), planTodo("b")];

    expect(todoOrder(todos)).toEqual({ ok: true, todos: [todos[1], todos[0]] });
  });

  it("gives one problem for each separate cycle", () => {
    const todos = [planTodo("a", ["b"]), planTodo("b", ["a"]), planTodo("c", ["d"]), planTodo("d", ["c"])];

    expect(problemsOf(todos)).toEqual([
      "todos: a dependency cycle between a, b",
      "todos: a dependency cycle between c, d",
    ]);
  });
});
