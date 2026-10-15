import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPlanAnswer } from "../../src/plan/answer.js";
import { planRevisionPath } from "../../src/store/layout.js";
import { TEST_EXECUTE_SESSION_ID, TEST_SESSION_ID } from "./fake-claude.js";
import {
  planAnswerStream,
  planRevisionOf,
  recordPlanRevisions,
  recordTestPlanRevision,
  seedExecuteSession,
  seedExecuteTodoStates,
  seedPlanRevision,
  seedPlanSession,
  seedPlanningTask,
  planTodo,
  seedTaskWithPlanFiles,
  transcriptLines,
  validPlanAnswer,
} from "./plan.js";
import { dayAt, seedTask, withDataRootStore } from "./store.js";
import { useTempDir } from "./temp.js";

describe("seedTaskWithPlanFiles", () => {
  const seed = { issueKey: "codeguru42/tasker#7", repoKey: "codeguru42/tasker", at: dayAt(3) };

  it("gives the files as the files_changed of revision v1 and keeps the state", () => {
    const dataRoot = useTempDir("tasker-seed-");

    const task = seedTaskWithPlanFiles(dataRoot, { ...seed, state: "awaiting_plan_review" }, ["src/a.ts"]);

    withDataRootStore(dataRoot, (store) => {
      expect(store.latestPlanRevision(task.id)?.answer.files_changed).toEqual(["src/a.ts"]);
      expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
    });
  });

  it("keeps the state finished", () => {
    const dataRoot = useTempDir("tasker-seed-");

    const task = seedTaskWithPlanFiles(dataRoot, { ...seed, state: "finished" }, ["src/a.ts"]);

    withDataRootStore(dataRoot, (store) => {
      expect(store.latestPlanRevision(task.id)?.answer.files_changed).toEqual(["src/a.ts"]);
      expect(store.getTask(task.id)?.state).toBe("finished");
    });
  });
});

describe("validPlanAnswer", () => {
  it("gives an answer that passes the plan checks", () => {
    expect(checkPlanAnswer(validPlanAnswer())).toEqual({ ok: true, answer: validPlanAnswer() });
  });

  it("replaces only the changed field", () => {
    const answer = validPlanAnswer({ summary: ["Other."] });

    expect(answer.summary).toEqual(["Other."]);
    expect({ ...answer, summary: validPlanAnswer().summary }).toEqual(validPlanAnswer());
  });

  it("gives separate objects for each call", () => {
    const first = validPlanAnswer();
    first.todos[0]!.title = "changed";
    first.files_changed.push("x");

    expect(validPlanAnswer().todos[0]!.title).toBe("Add the a module");
    expect(validPlanAnswer().files_changed).toEqual(["src/a.ts", "test/a.test.ts"]);
  });
});

describe("planTodo", () => {
  it("gives a todo with no dependency from its id", () => {
    expect(planTodo("a")).toEqual({ id: "a", title: "Do a", description: "The work of a.", depends_on: [] });
  });

  it("gives the dependencies and the changed fields", () => {
    expect(planTodo("b", ["a"], { description: "x\ny" })).toEqual({
      id: "b",
      title: "Do b",
      description: "x\ny",
      depends_on: ["a"],
    });
  });
});

describe("seedPlanRevision", () => {
  it("writes the plan_revision event, sets awaiting_plan_review and writes no transition", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      const before = store.listEvents(task.id).length;

      seedPlanRevision(store, task.id);

      expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
      expect(store.listEvents(task.id).slice(before).map(({ type, data }) => ({ type, data }))).toEqual([
        { type: "plan_revision", data: { version: 1, prompt: "plan@000000000000" } },
      ]);
    });
  });

  it("sets the given state", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      seedPlanRevision(store, task.id, {}, "approved");

      expect(store.getTask(task.id)?.state).toBe("approved");
    });
  });

  it("gives the versions 1 and 2 for consecutive calls", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      expect(seedPlanRevision(store, task.id).version).toBe(1);
      expect(seedPlanRevision(store, task.id).version).toBe(2);
    });
  });

  it("gives a valid answer unless the call changes it", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      expect(seedPlanRevision(store, task.id).answer).toEqual(validPlanAnswer());
    });
  });

  it("keeps a given feedback and source", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      const revision = seedPlanRevision(store, task.id, { feedback: "use main", source: "refine" });

      expect(revision).toMatchObject({ feedback: "use main", source: "refine" });
    });
  });
});

describe("recordTestPlanRevision", () => {
  it("writes the plan file and the row and moves the task to awaiting_plan_review", () => {
    const dataRoot = useTempDir("tasker-record-");
    withDataRootStore(dataRoot, (store) => {
      const task = seedTask(store);
      const markdown = "## Summary\n\nhelper text\n";

      recordTestPlanRevision(store, dataRoot, task.id, {
        answer: validPlanAnswer({ plan_markdown: markdown }),
      });

      expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
      expect(store.getPlanRevision(task.id, 1)).toBeDefined();
      expect(readFileSync(planRevisionPath(dataRoot, task, 1), "utf8")).toBe(markdown);
    });
  });
});

describe("seedPlanningTask", () => {
  it("seeds the task of codeguru42/tasker#5 in the state planning in the data root", () => {
    const { dataRoot, task } = seedPlanningTask();

    expect(task).toMatchObject({ issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state: "planning" });
    const found = withDataRootStore(dataRoot, (store) =>
      store.findLatestTask("codeguru42/tasker", "codeguru42/tasker#5"),
    );
    expect(found?.id).toBe(task.id);
  });
});

describe("recordPlanRevisions", () => {
  it("records v1 with its plan file and leaves the task in awaiting_plan_review", () => {
    const { dataRoot, task } = seedPlanningTask();
    const markdown = "## Summary\n\nfirst\n";

    recordPlanRevisions(dataRoot, task, { answer: validPlanAnswer({ plan_markdown: markdown }) });

    withDataRootStore(dataRoot, (store) => {
      expect(store.getPlanRevision(task.id, 1)).toBeDefined();
      expect(store.getPlanRevision(task.id, 2)).toBeUndefined();
      expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
    });
    expect(readFileSync(planRevisionPath(dataRoot, task, 1), "utf8")).toBe(markdown);
  });

  it("with second, records v2 after the refining state with its plan file", () => {
    const { dataRoot, task } = seedPlanningTask();
    const markdown = "## Summary\n\nsecond\n";

    recordPlanRevisions(
      dataRoot,
      task,
      {},
      { source: "refine", feedback: "Use main.", answer: validPlanAnswer({ plan_markdown: markdown }) },
    );

    withDataRootStore(dataRoot, (store) => {
      expect(store.getPlanRevision(task.id, 2)).toMatchObject({ source: "refine", feedback: "Use main." });
      expect(store.getTask(task.id)?.state).toBe("awaiting_plan_review");
    });
    expect(readFileSync(planRevisionPath(dataRoot, task, 2), "utf8")).toBe(markdown);
  });
});

describe("planRevisionOf", () => {
  it("gives the revision of the version, and undefined for a version with none", () => {
    const { dataRoot, task } = seedPlanningTask();
    recordPlanRevisions(dataRoot, task, {}, { source: "refine", feedback: "Use main." });

    expect(planRevisionOf(dataRoot, task.id, 2)).toMatchObject({ version: 2, source: "refine" });
    expect(planRevisionOf(dataRoot, task.id, 3)).toBeUndefined();
  });
});

describe("transcriptLines", () => {
  it("gives the lines of the file with no empty last item", () => {
    const path = join(useTempDir("tasker-transcript-"), "t.jsonl");
    writeFileSync(path, "a\nb\n");

    expect(transcriptLines(path)).toEqual(["a", "b"]);
  });
});

describe("seedPlanSession", () => {
  it("records TEST_SESSION_ID with the plan model of the test configurations", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      const session = seedPlanSession(store, task.id);

      expect(session).toEqual({
        sessionId: TEST_SESSION_ID,
        repoKey: "a/b",
        provider: "claude-code",
        model: "opus",
        effort: "high",
      });
      expect(store.planSession(task.id)).toEqual(session);
    });
  });

  it("uses the values that the call changes", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      const session = seedPlanSession(store, task.id, { sessionId: "x", effort: "low" });

      expect(session).toMatchObject({ sessionId: "x", effort: "low", model: "opus", provider: "claude-code" });
    });
  });
});

describe("seedExecuteSession", () => {
  it("records TEST_EXECUTE_SESSION_ID with the execute model of the test configurations", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      seedPlanRevision(store, task.id);

      const session = seedExecuteSession(store, task.id, 1);

      expect(session).toEqual({
        sessionId: TEST_EXECUTE_SESSION_ID,
        repoKey: "a/b",
        provider: "claude-code",
        model: "sonnet",
        effort: "medium",
      });
      expect(store.executeSession(task.id, 1)).toEqual(session);
    });
  });

  it("uses the values that the call changes", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      seedPlanRevision(store, task.id);

      const session = seedExecuteSession(store, task.id, 1, { sessionId: "x", effort: "low" });

      expect(session).toMatchObject({ sessionId: "x", effort: "low", model: "sonnet", provider: "claude-code" });
    });
  });
});

describe("seedExecuteTodoStates", () => {
  it("sets the state of each todo that the record names", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      seedPlanRevision(store, task.id);

      seedExecuteTodoStates(store, task.id, 1, { "write-test": "done", "make-it-pass": "in_progress" });

      expect(store.executeTodoProgress(task.id, 1).map(({ todo, state }) => [todo.id, state])).toEqual([
        ["write-test", "done"],
        ["make-it-pass", "in_progress"],
      ]);
    });
  });

  it("leaves each todo not started for an empty record", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      seedPlanRevision(store, task.id);

      seedExecuteTodoStates(store, task.id, 1, {});

      expect(store.executeTodoProgress(task.id, 1).map(({ state }) => state)).toEqual([
        "not_started",
        "not_started",
      ]);
    });
  });
});

describe("planAnswerStream", () => {
  it("gives a last line whose structured_output is the answer", () => {
    const answer = validPlanAnswer({ summary: ["Another."] });
    const lines = planAnswerStream(answer);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ structured_output: answer });
  });
});
