import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkPlanAnswer } from "../../src/plan/answer.js";
import { planRevisionPath } from "../../src/store/layout.js";
import { TEST_EXECUTE_SESSION_ID, TEST_SESSION_ID } from "./fake-claude.js";
import {
  answerStream,
  planRevisionOf,
  recordPlanRevisions,
  recordTestPlanRevision,
  seedExecuteFixTurn,
  seedExecuteSession,
  seedExecuteTodoStates,
  seedPinnedPlanRevision,
  seedPlanReviewTask,
  seedPlanRevision,
  seedPlanSession,
  seedPlanningTask,
  planStateSnapshot,
  planTodo,
  runApprove,
  seedApprovedTask,
  seedTaskWithPlanFiles,
  transcriptLines,
  turnResultStream,
  validPlanAnswer,
} from "./plan.js";
import { dayAt, eventsOf, seedTask, withDataRootStore } from "./store.js";
import { useTempDir, useTempFile } from "./temp.js";

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
    first.todos[0].title = "changed";
    first.files_changed.push("x");

    expect(validPlanAnswer().todos[0].title).toBe("Add the a module");
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
      expect(
        store
          .listEvents(task.id)
          .slice(before)
          .map(({ type, data }) => ({ type, data })),
      ).toEqual([{ type: "plan_revision", data: { version: 1, prompt: "plan@000000000000" } }]);
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

describe("seedPinnedPlanRevision", () => {
  it("gives the revision that is the pinned revision, with version 1", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      const revision = seedPinnedPlanRevision(store, task.id);

      expect(revision.version).toBe(1);
      expect(revision).toEqual(store.pinnedPlanRevision(task.id));
    });
  });

  it("sets the task to approved when it gets no state", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      seedPinnedPlanRevision(store, task.id);

      expect(store.getTask(task.id)?.state).toBe("approved");
    });
  });

  it("sets the given state", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);

      seedPinnedPlanRevision(store, task.id, {}, "executed");

      expect(store.getTask(task.id)?.state).toBe("executed");
    });
  });

  it("stores a given change", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      const answer = validPlanAnswer({ files_changed: ["src/other.ts"] });

      const revision = seedPinnedPlanRevision(store, task.id, { answer });

      expect(revision.answer).toEqual(answer);
    });
  });
});

describe("seedExecuteFixTurn", () => {
  it("queues a fix turn with the failure npm test failed and no log tail", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      seedPlanRevision(store, task.id);

      seedExecuteFixTurn(store, task.id, 1);

      expect(store.queuedExecuteFixTurn(task.id, 1)).toMatchObject({
        verifyFailure: "npm test failed",
        verifyLogTail: null,
      });
      expect(store.executeFixTurnState(task.id, 1)).toBe("queued");
    });
  });

  it("marks the fix turn done when the state is done", () => {
    withDataRootStore(useTempDir("tasker-seed-"), (store) => {
      const task = seedTask(store);
      seedPlanRevision(store, task.id);

      seedExecuteFixTurn(store, task.id, 1, "done");

      expect(store.queuedExecuteFixTurn(task.id, 1)).toBeUndefined();
      expect(store.executeFixTurnState(task.id, 1)).toBe("done");
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
    const path = useTempFile("tasker-transcript-", "t.jsonl", "a\nb\n");

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

      expect(store.executeTodoProgress(task.id, 1).map(({ state }) => state)).toEqual(["not_started", "not_started"]);
    });
  });
});

describe("answerStream", () => {
  it("gives a last line whose structured_output is the answer", () => {
    const answer = validPlanAnswer({ summary: ["Another."] });
    const lines = answerStream(answer);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ structured_output: answer });
  });
});

describe("turnResultStream", () => {
  it("gives a last line whose structured_output is a blocked result with its reason", () => {
    const lines = turnResultStream("blocked", "No disk.");

    expect(JSON.parse(lines.at(-1)!).structured_output).toEqual({ result: "blocked", reason: "No disk." });
  });

  it("gives a done result with no reason key", () => {
    const lines = turnResultStream("done");

    expect(JSON.parse(lines.at(-1)!).structured_output).toStrictEqual({ result: "done" });
  });

  it("applies the edit to the result event and keeps the structured output", () => {
    const denials = [{ tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "git push" } }];

    const lines = turnResultStream("done", undefined, (event) => {
      event.permission_denials = denials;
    });

    const last = JSON.parse(lines.at(-1)!);
    expect(last.permission_denials).toEqual(denials);
    expect(last.structured_output).toStrictEqual({ result: "done" });
    expect(last.result).toBe(JSON.stringify({ result: "done" }));
  });
});

describe("seedPlanReviewTask", () => {
  it("gives a task in awaiting_plan_review with v1 only, with its plan file and no approval", () => {
    const { dataRoot, task } = seedPlanReviewTask();

    expect(task.state).toBe("awaiting_plan_review");
    expect(planRevisionOf(dataRoot, task.id, 1)?.approvedAt).toBeNull();
    expect(planRevisionOf(dataRoot, task.id, 2)).toBeUndefined();
    expect(existsSync(planRevisionPath(dataRoot, task, 1))).toBe(true);
  });

  it("gives a task in awaiting_plan_review with no revision for an empty list", () => {
    const { dataRoot, task } = seedPlanReviewTask({ revisions: [] });

    expect(task.state).toBe("awaiting_plan_review");
    expect(planRevisionOf(dataRoot, task.id, 1)).toBeUndefined();
  });

  it("makes each later revision a refine with its own feedback, and keeps a feedback that the entry gives", () => {
    const { dataRoot, task } = seedPlanReviewTask({ revisions: [{}, {}, { feedback: "Use main." }] });

    expect(planRevisionOf(dataRoot, task.id, 1)?.source).toBe("plan");
    expect(planRevisionOf(dataRoot, task.id, 2)).toMatchObject({ source: "refine", feedback: "Refine v2." });
    expect(planRevisionOf(dataRoot, task.id, 3)).toMatchObject({ source: "refine", feedback: "Use main." });
    expect(task.state).toBe("awaiting_plan_review");
  });

  it("approves the revision of approved and goes back to awaiting_plan_review", () => {
    const { dataRoot, task } = seedPlanReviewTask({ revisions: [{}, {}, {}], approved: 1 });

    expect(planRevisionOf(dataRoot, task.id, 1)?.approvedAt).not.toBeNull();
    expect(planRevisionOf(dataRoot, task.id, 2)?.approvedAt).toBeNull();
    expect(planRevisionOf(dataRoot, task.id, 3)?.approvedAt).toBeNull();
    expect(withDataRootStore(dataRoot, (store) => store.pinnedPlanRevision(task.id))?.version).toBe(1);
    expect(task.state).toBe("awaiting_plan_review");
  });
});

describe("seedApprovedTask", () => {
  it("gives a task in approved with v1 pinned", () => {
    const { dataRoot, task } = seedApprovedTask();

    expect(task.state).toBe("approved");
    expect(planRevisionOf(dataRoot, task.id, 1)?.approvedAt).not.toBeNull();
    expect(withDataRootStore(dataRoot, (store) => store.pinnedPlanRevision(task.id))?.version).toBe(1);
  });

  it("pins the newest revision and keeps the older approval of approved", () => {
    const { dataRoot, task } = seedApprovedTask({ revisions: [{}, {}, {}], approved: 1 });

    expect(planRevisionOf(dataRoot, task.id, 1)?.approvedAt).not.toBeNull();
    expect(planRevisionOf(dataRoot, task.id, 2)?.approvedAt).toBeNull();
    expect(planRevisionOf(dataRoot, task.id, 3)?.approvedAt).not.toBeNull();
    expect(withDataRootStore(dataRoot, (store) => store.pinnedPlanRevision(task.id))?.version).toBe(3);
    expect(task.state).toBe("approved");
  });
});

describe("planStateSnapshot", () => {
  it("gives the state, the events and the approval of each version", () => {
    const { dataRoot, task } = seedPlanReviewTask({ revisions: [{}, {}], approved: 1 });

    const snapshot = planStateSnapshot(dataRoot, "codeguru42/tasker#5", task.id, [1, 2, 3]);

    expect(snapshot.state).toBe("awaiting_plan_review");
    expect(snapshot.events).toEqual(eventsOf(dataRoot, "codeguru42/tasker#5"));
    expect(snapshot.approvedAt[0]).not.toBeNull();
    expect(snapshot.approvedAt[1]).toBeNull();
    expect(snapshot.approvedAt[2]).toBeUndefined();
  });
});

describe("runApprove", () => {
  it("approves the task of seedPlanReviewTask", async () => {
    const { dataRoot, task } = seedPlanReviewTask();

    const result = await runApprove();

    expect(result.code).toBe(0);
    expect(result.out.startsWith("approved codeguru42/tasker#5 at revision v1")).toBe(true);
    expect(withDataRootStore(dataRoot, (store) => store.getTask(task.id))?.state).toBe("approved");
  });

  it("passes the extra arguments after the repo option", async () => {
    seedPlanReviewTask();

    const result = await runApprove("codeguru42/tasker#5", "--bogus");

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("--bogus");
  });
});
