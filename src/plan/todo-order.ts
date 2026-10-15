interface OrderTodo {
  id: string;
  depends_on: readonly string[];
}

type TodoOrder<T> = { ok: true; todos: T[] } | { ok: false; problems: string[] };

// The first todo of left, in plan order, that the todo depends on.
function firstDependency<T extends OrderTodo>(todo: T, left: readonly T[]): T {
  return left.find((other) => todo.depends_on.includes(other.id))!;
}

// One cycle of left, found from its first todo. Left holds no ready todo, so each todo has a dependency in left.
function findCycle<T extends OrderTodo>(left: readonly T[]): T[] {
  const path: T[] = [];
  let current = left[0]!;
  while (!path.includes(current)) {
    path.push(current);
    current = firstDependency(current, left);
  }
  return path.slice(path.indexOf(current));
}

// The one home of the order and of the cycle text. docs/dev/assistants.md gives the reasons.
export function todoOrder<T extends OrderTodo>(todos: readonly T[]): TodoOrder<T> {
  const ordered: T[] = [];
  const problems: string[] = [];
  let left = [...todos];
  while (left.length > 0) {
    const current = left;
    const ready = current.find((todo) => !current.some((other) => todo.depends_on.includes(other.id)));
    if (ready !== undefined) {
      ordered.push(ready);
      left = current.filter((todo) => todo !== ready);
      continue;
    }
    const cycle = findCycle(current);
    const members = current.filter((todo) => cycle.includes(todo));
    problems.push(`todos: a dependency cycle between ${members.map((todo) => todo.id).join(", ")}`);
    left = current.filter((todo) => !cycle.includes(todo));
  }
  return problems.length === 0 ? { ok: true, todos: ordered } : { ok: false, problems };
}

// The order of an execute run. It throws for a cycle, because a stored revision from
// before the plan check can hold one.
export function orderTodos<T extends OrderTodo>(todos: readonly T[]): T[] {
  const order = todoOrder(todos);
  if (!order.ok) throw new Error(order.problems.join("\n"));
  return order.todos;
}
