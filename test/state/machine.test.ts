import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SPAWNING_STATES,
  STATES,
  TERMINAL_STATES,
  canTransition,
  failTask,
  failedFrom,
  failedFromEvents,
  lastFailIndex,
  isSpawningState,
  isTerminalState,
  isTaskState,
  transitionTask,
  transitionWithAcceptance,
  transitionWithExecution,
  transitionWithPlanApproval,
  transitionWithPlanRevision,
  transitionWithPlanUnapproval,
  transitionWithRetry,
  transitionWithVerifyRun,
  type TaskState,
  type TransitionDetail,
} from "../../src/state/machine.js";
import { openStore, type TaskStore } from "../../src/store/store.js";
import { seedExecuteSession, seedPinnedPlanRevision, seedPlanRevision, seedPlanSession, validPlanAnswer } from "../helpers/plan.js";
import { useTempDir } from "../helpers/temp.js";

describe("spawning states", () => {
  it("has the ten spawning states", () => {
    expect([...SPAWNING_STATES].sort()).toEqual(
      [
        "planning",
        "refining",
        "executing",
        "verifying",
        "reviewing",
        "pushing",
        "opening_pr",
        "merging",
        "finishing",
        "updating_branch",
      ].sort(),
    );
  });

  it("tells a spawning state from another state", () => {
    expect(isSpawningState("executing")).toBe(true);
    expect(isSpawningState("approved")).toBe(false);
    expect(isSpawningState("nope")).toBe(false);
  });

  it("tells a terminal state from another state", () => {
    for (const state of TERMINAL_STATES) expect(isTerminalState(state)).toBe(true);
    expect(isTerminalState("provisioning")).toBe(false);
    expect(isTerminalState("nope")).toBe(false);
  });
});

describe("task states", () => {
  it("declares the 28 states in order", () => {
    expect(STATES).toEqual([
      "provisioning",
      "workspace_ready",
      "planning",
      "awaiting_plan_review",
      "refining",
      "approved",
      "executing",
      "executed",
      "verifying",
      "awaiting_work_review",
      "reviewing",
      "reviewed",
      "accepted",
      "pushing",
      "pushed",
      "opening_pr",
      "in_peer_review",
      "merging",
      "landed",
      "finishing",
      "cleanup_failed",
      "finished",
      "updating_branch",
      "quota_blocked",
      "awaiting_quota_approval",
      "interrupted",
      "failed",
      "cancelled",
    ]);
  });

  it("does not declare awaiting_input", () => {
    expect(STATES).not.toContain("awaiting_input");
  });

  it("has finished and cancelled as the terminal states", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(["cancelled", "finished"]);
  });

  it("tells a known state from an unknown one", () => {
    expect(isTaskState("planning")).toBe(true);
    expect(isTaskState("awaiting_input")).toBe(false);
    expect(isTaskState("new")).toBe(false);
  });
});

const NON_TERMINAL = STATES.filter((s) => !TERMINAL_STATES.has(s));

describe("rule edges", () => {
  it.each(STATES)("refuses the self-transition of %s", (state) => {
    expect(canTransition(state, state)).toBe(false);
  });

  it.each(NON_TERMINAL)("allows %s -> cancelled", (state) => {
    expect(canTransition(state, "cancelled")).toBe(true);
  });

  it.each(NON_TERMINAL.filter((s) => s !== "failed"))(
    "allows %s -> failed",
    (state) => {
      expect(canTransition(state, "failed")).toBe(true);
    },
  );

  it.each(["finished", "cancelled"] as TaskState[])(
    "allows no edge out of %s",
    (terminal) => {
      for (const to of STATES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    },
  );

  it("refuses failed -> failed", () => {
    expect(canTransition("failed", "failed")).toBe(false);
  });
});

const SPECIFIC: Record<string, string[]> = {
  provisioning: ["workspace_ready"],
  workspace_ready: ["planning", "updating_branch"],
  planning: ["awaiting_plan_review", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  awaiting_plan_review: ["refining", "approved", "updating_branch"],
  refining: ["awaiting_plan_review", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  approved: ["awaiting_plan_review", "executing", "updating_branch"],
  executing: ["executed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  executed: ["verifying", "updating_branch"],
  verifying: ["awaiting_work_review", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  awaiting_work_review: ["reviewing", "refining", "accepted", "updating_branch"],
  reviewing: ["awaiting_work_review", "reviewed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  reviewed: ["refining", "awaiting_work_review", "updating_branch"],
  accepted: ["landed", "merging", "pushing", "refining", "updating_branch"],
  pushing: ["pushed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  pushed: ["landed", "opening_pr", "refining", "updating_branch"],
  opening_pr: ["in_peer_review", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  in_peer_review: ["landed", "merging", "updating_branch"],
  merging: ["landed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  landed: ["finishing"],
  finishing: ["finished", "cleanup_failed", "quota_blocked", "awaiting_quota_approval", "interrupted"],
  cleanup_failed: ["finishing", "updating_branch"],
  updating_branch: [
    "workspace_ready", "awaiting_plan_review", "approved", "executed", "awaiting_work_review",
    "reviewed", "accepted", "pushed", "in_peer_review", "failed", "cleanup_failed",
    "quota_blocked", "awaiting_quota_approval", "interrupted",
  ],
  quota_blocked: ["workspace_ready", "awaiting_plan_review", "approved", "awaiting_work_review", "accepted", "reviewed"],
  awaiting_quota_approval: ["workspace_ready", "awaiting_plan_review", "approved", "awaiting_work_review", "accepted", "reviewed"],
  interrupted: [
    "workspace_ready", "awaiting_plan_review", "approved", "awaiting_work_review", "accepted", "reviewed",
    "executed", "in_peer_review", "pushed", "cleanup_failed", "landed",
  ],
  failed: [
    "provisioning", "workspace_ready", "awaiting_plan_review", "approved", "executed", "accepted",
    "awaiting_work_review", "reviewed", "in_peer_review", "refining", "pushed", "updating_branch",
  ],
};

// An independent copy of the specific edges of the table.
const TABLE_EDGES = Object.entries(SPECIFIC).flatMap(([from, targets]) =>
  targets.map((to) => [from, to] as [TaskState, TaskState]),
);

const LEGAL_EDGES = new Set(TABLE_EDGES.map(([from, to]) => `${from} -> ${to}`));
for (const state of NON_TERMINAL) {
  if (state !== "failed") LEGAL_EDGES.add(`${state} -> failed`);
  LEGAL_EDGES.add(`${state} -> cancelled`);
}

const ILLEGAL_EDGES: [TaskState, TaskState][] = [
  ["provisioning", "planning"],
  ["workspace_ready", "approved"],
  ["planning", "executing"],
  ["awaiting_plan_review", "executing"],
  ["executing", "verifying"],
  ["verifying", "accepted"],
  ["awaiting_work_review", "landed"],
  ["accepted", "in_peer_review"],
  ["pushed", "merging"],
  ["landed", "refining"],
  ["quota_blocked", "planning"],
  ["interrupted", "provisioning"],
  ["failed", "verifying"],
  ["finished", "provisioning"],
  ["cancelled", "failed"],
];

describe("table edges", () => {
  it("has 120 specific edges", () => {
    expect(TABLE_EDGES).toHaveLength(120);
  });

  it.each(TABLE_EDGES)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it("allows exactly the legal edges", () => {
    const found = new Set<string>();
    for (const from of STATES) {
      for (const to of STATES) {
        if (canTransition(from, to)) found.add(`${from} -> ${to}`);
      }
    }
    expect(found).toEqual(LEGAL_EDGES);
    expect(found.size).toBe(170);
  });

  it.each(ILLEGAL_EDGES)("refuses %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("task transitions", () => {
  let dir: string;
  let store: TaskStore;

  beforeEach(() => {
    dir = useTempDir("tasker-data-");
    store = openStore(join(dir, "tasker.db"));
  });

  afterEach(() => {
    store.close();
  });

  const newTask = (state: string) => ({
    issueKey: "codeguru42/tasker#7",
    repoKey: "tasker",
    state,
  });

  describe("transitionTask", () => {
    it("moves a task along a legal edge", () => {
      const task = store.createTask(newTask("planning"));
      const moved = transitionTask(store, task.id, "awaiting_plan_review");
      expect(moved.state).toBe("awaiting_plan_review");
      expect(store.getTask(task.id)!.state).toBe("awaiting_plan_review");
    });

    it("refuses an illegal edge and keeps the state", () => {
      const task = store.createTask(newTask("planning"));
      expect(() => transitionTask(store, task.id, "finished")).toThrow(
        "illegal state transition: planning -> finished",
      );
      expect(store.getTask(task.id)!.state).toBe("planning");
    });

    it("names both states when a terminal task moves", () => {
      const task = store.createTask(newTask("finished"));
      expect(() => transitionTask(store, task.id, "cancelled")).toThrow(
        /finished.*cancelled/,
      );
    });

    it("refuses a stored state that is not a known state", () => {
      const task = store.createTask(newTask("awaiting_input"));
      expect(() => transitionTask(store, task.id, "workspace_ready")).toThrow(
        "illegal state transition: awaiting_input -> workspace_ready",
      );
    });

    it("keeps the store error for a missing task", () => {
      expect(() => transitionTask(store, 999, "planning")).toThrow(
        "task not found: 999",
      );
    });

    it("writes one transition event after the created event", () => {
      const task = store.createTask(newTask("planning"));
      transitionTask(store, task.id, "awaiting_plan_review");
      const events = store.listEvents(task.id);
      expect(events.map((e) => e.type)).toEqual(["created", "transition"]);
      expect(events[1].data).toEqual({
        from: "planning",
        to: "awaiting_plan_review",
      });
    });

    it("merges the fields of detail into the event data", () => {
      const task = store.createTask(newTask("planning"));
      transitionTask(store, task.id, "failed", { error: "boom" });
      expect(store.listEvents(task.id).at(-1)?.data).toEqual({
        error: "boom",
        from: "planning",
        to: "failed",
      });
    });

    it("keeps the real from and to when detail names them", () => {
      const task = store.createTask(newTask("planning"));
      transitionTask(store, task.id, "failed", {
        from: "x",
        to: "y",
        note: 1,
      } as unknown as TransitionDetail);
      expect(store.listEvents(task.id).at(-1)?.data).toEqual({
        from: "planning",
        to: "failed",
        note: 1,
      });
    });

    it("rejects a detail that names from", () => {
      const task = store.createTask(newTask("planning"));
      // @ts-expect-error detail cannot set from
      transitionTask(store, task.id, "failed", { from: "x" });
    });

    it("writes no event for an illegal edge", () => {
      const task = store.createTask(newTask("planning"));
      const before = store.listEvents(task.id);
      expect(() => transitionTask(store, task.id, "finished")).toThrow(
        "illegal state transition: planning -> finished",
      );
      expect(store.getTask(task.id)!.state).toBe("planning");
      expect(store.listEvents(task.id)).toEqual(before);
    });

    it("writes the run marker on a move into a spawning state", () => {
      const task = store.createTask(newTask("approved"));
      expect(transitionTask(store, task.id, "executing").state).toBe("executing");
      expect(store.runStatus(task.id)).toEqual({ status: "running" });
      expect(store.listEvents(task.id).at(-1)).toMatchObject({
        type: "transition",
        data: { from: "approved", to: "executing" },
      });
    });

    it("deletes the run marker on a move out of a spawning state", () => {
      const task = store.createTask(newTask("approved"));
      transitionTask(store, task.id, "executing");
      expect(store.runStatus(task.id)).toEqual({ status: "running" });
      expect(transitionTask(store, task.id, "executed").state).toBe("executed");
      expect(store.listEvents(task.id).at(-1)).toMatchObject({
        type: "transition",
        data: { from: "executing", to: "executed" },
      });
      // A marker that stays makes the next move into a spawning state fail.
      expect(transitionTask(store, task.id, "verifying").state).toBe("verifying");
      expect(store.runStatus(task.id)).toEqual({ status: "running" });
    });

    it("refuses an illegal edge into a spawning state and writes no marker", () => {
      const task = store.createTask(newTask("workspace_ready"));
      const before = store.listEvents(task.id);
      expect(() => transitionTask(store, task.id, "executing")).toThrow(
        "illegal state transition: workspace_ready -> executing",
      );
      expect(store.getTask(task.id)!.state).toBe("workspace_ready");
      expect(store.runStatus(task.id)).toEqual({ status: "none" });
      expect(store.listEvents(task.id)).toEqual(before);
      transitionTask(store, task.id, "planning");
      expect(store.runStatus(task.id)).toEqual({ status: "running" });
    });

    it("refuses an illegal edge out of a spawning state and keeps the marker", () => {
      const task = store.createTask(newTask("approved"));
      transitionTask(store, task.id, "executing");
      const before = store.listEvents(task.id);
      expect(() => transitionTask(store, task.id, "approved")).toThrow(
        "illegal state transition: executing -> approved",
      );
      expect(store.getTask(task.id)!.state).toBe("executing");
      expect(store.runStatus(task.id)).toEqual({ status: "running" });
      expect(store.listEvents(task.id)).toEqual(before);
    });
  });

  describe("transitionWithPlanRevision", () => {
    const revision = {
      version: 1,
      source: "plan" as const,
      answer: validPlanAnswer(),
      prompt: "plan@000000000000",
    };

    it("moves planning to awaiting_plan_review, inserts the row and appends plan_revision, then transition", () => {
      const task = store.createTask(newTask("planning"));
      const moved = transitionWithPlanRevision(store, task.id, "awaiting_plan_review", revision);
      expect(moved.state).toBe("awaiting_plan_review");
      expect(store.getPlanRevision(task.id, 1)).toBeDefined();
      const events = store.listEvents(task.id);
      expect(events.map((e) => e.type)).toEqual(["created", "plan_revision", "transition"]);
      expect(events[1].data).toEqual({ version: 1, prompt: "plan@000000000000" });
      expect(events[2].data).toEqual({ from: "planning", to: "awaiting_plan_review" });
    });

    it("writes no row for an illegal edge", () => {
      const task = store.createTask(newTask("workspace_ready"));
      expect(() => transitionWithPlanRevision(store, task.id, "awaiting_plan_review", revision)).toThrow(
        "illegal state transition: workspace_ready -> awaiting_plan_review",
      );
      expect(store.getPlanRevision(task.id, 1)).toBeUndefined();
      expect(store.getTask(task.id)!.state).toBe("workspace_ready");
      expect(store.listEvents(task.id).map((e) => e.type)).toEqual(["created"]);
    });
  });

  describe("transitionWithPlanApproval", () => {
    it("approves the revision and moves the task with one approved event", () => {
      const task = store.createTask(newTask("planning"));
      seedPlanRevision(store, task.id);
      const moved = transitionWithPlanApproval(store, task.id, 1, 2);
      expect(moved.state).toBe("approved");
      expect(store.getPlanRevision(task.id, 1)!.approvedAt).not.toBeNull();
      const events = store.listEvents(task.id);
      expect(events.map((e) => e.type)).toEqual(["created", "plan_revision", "approved"]);
      expect(events[2].data).toEqual({
        version: 1,
        openQuestions: 2,
        from: "awaiting_plan_review",
        to: "approved",
      });
    });

    it("writes nothing for an illegal edge", () => {
      const task = store.createTask(newTask("planning"));
      seedPlanRevision(store, task.id, {}, "workspace_ready");
      const before = store.listEvents(task.id);
      expect(() => transitionWithPlanApproval(store, task.id, 1, 0)).toThrow(
        "illegal state transition: workspace_ready -> approved",
      );
      expect(store.getTask(task.id)!.state).toBe("workspace_ready");
      expect(store.getPlanRevision(task.id, 1)!.approvedAt).toBeNull();
      expect(store.listEvents(task.id)).toEqual(before);
    });
  });

  describe("transitionWithPlanUnapproval", () => {
    it("clears the pinned approval and moves the task with one unapproved event", () => {
      const task = store.createTask(newTask("planning"));
      seedPlanRevision(store, task.id);
      transitionWithPlanApproval(store, task.id, 1, 0);
      const moved = transitionWithPlanUnapproval(store, task.id, 1);
      expect(moved.state).toBe("awaiting_plan_review");
      expect(store.getPlanRevision(task.id, 1)!.approvedAt).toBeNull();
      const events = store.listEvents(task.id);
      expect(events.map((e) => e.type)).toEqual(["created", "plan_revision", "approved", "unapproved"]);
      expect(events[3].data).toEqual({ version: 1, from: "approved", to: "awaiting_plan_review" });
    });

    it("writes nothing for an illegal edge", () => {
      const task = store.createTask(newTask("planning"));
      seedPinnedPlanRevision(store, task.id, {}, "workspace_ready");
      const before = store.listEvents(task.id);
      const approvedAt = store.getPlanRevision(task.id, 1)!.approvedAt;
      expect(() => transitionWithPlanUnapproval(store, task.id, 1)).toThrow(
        "illegal state transition: workspace_ready -> awaiting_plan_review",
      );
      expect(store.getTask(task.id)!.state).toBe("workspace_ready");
      expect(store.getPlanRevision(task.id, 1)!.approvedAt).toBe(approvedAt);
      expect(store.listEvents(task.id)).toEqual(before);
    });
  });

  describe("transitionWithExecution", () => {
    it("moves the task to executed with one executed event and deletes the run marker", () => {
      const task = store.createTask(newTask("approved"));
      transitionTask(store, task.id, "executing");
      const moved = transitionWithExecution(store, task.id, 1, ["execute@a", "execute-todo@b"]);
      expect(moved.state).toBe("executed");
      expect(store.runStatus(task.id)).toEqual({ status: "none" });
      const events = store.listEvents(task.id);
      expect(events.map((e) => e.type)).toEqual(["created", "transition", "executed"]);
      expect(events[2].data).toEqual({
        version: 1,
        prompts: ["execute@a", "execute-todo@b"],
        from: "executing",
        to: "executed",
      });
    });

    it("writes nothing for an illegal edge", () => {
      const task = store.createTask(newTask("workspace_ready"));
      const before = store.listEvents(task.id);
      expect(() => transitionWithExecution(store, task.id, 1, [])).toThrow(
        "illegal state transition: workspace_ready -> executed",
      );
      expect(store.getTask(task.id)!.state).toBe("workspace_ready");
      expect(store.listEvents(task.id)).toEqual(before);
    });
  });

  describe("transitionWithAcceptance", () => {
    const accept = (id: number) => transitionWithAcceptance(store, id, "head-sha", "base-sha");

    it("writes one accepted event in place of the transition event", () => {
      const task = store.createTask(newTask("workspace_ready"));
      for (const state of [
        "planning",
        "awaiting_plan_review",
        "approved",
        "executing",
        "executed",
        "verifying",
        "awaiting_work_review",
      ] as const) {
        transitionTask(store, task.id, state);
      }
      const before = store.listEvents(task.id);

      const moved = accept(task.id);

      expect(moved.state).toBe("accepted");
      const events = store.listEvents(task.id);
      expect(events.slice(0, before.length)).toEqual(before);
      expect(events.slice(before.length).map((e) => e.type)).toEqual(["accepted"]);
      expect(events[events.length - 1].data).toEqual({
        revision: "head-sha",
        baseTip: "base-sha",
        from: "awaiting_work_review",
        to: "accepted",
      });
    });

    it("writes nothing for an illegal edge", () => {
      const task = store.createTask(newTask("approved"));
      transitionTask(store, task.id, "executing");
      transitionTask(store, task.id, "executed");
      const before = store.listEvents(task.id);
      expect(() => accept(task.id)).toThrow("illegal state transition: executed -> accepted");
      expect(store.getTask(task.id)!.state).toBe("executed");
      expect(store.listEvents(task.id)).toEqual(before);
    });
  });

  describe("transitionWithRetry", () => {
    it("writes one retry event in place of the transition event, with the writes", () => {
      const task = store.createTask(newTask("failed"));
      seedPlanSession(store, task.id);

      const moved = transitionWithRetry(
        store,
        task.id,
        "workspace_ready",
        { origin: "planning", resumeExecute: false },
        { clearPlanSession: true },
      );

      expect(moved.state).toBe("workspace_ready");
      expect(store.planSession(task.id)).toBeUndefined();
      const events = store.listEvents(task.id);
      expect(events.map((e) => e.type)).toEqual(["created", "retry"]);
      expect(events[1].data).toEqual({
        origin: "planning",
        target: "workspace_ready",
        resumeExecute: false,
        from: "failed",
        to: "workspace_ready",
      });
    });

    it("writes nothing for an illegal edge", () => {
      const task = store.createTask(newTask("failed"));
      seedPlanRevision(store, task.id, {}, "failed");
      seedExecuteSession(store, task.id, 1);

      expect(() =>
        transitionWithRetry(
          store,
          task.id,
          "planning",
          { origin: "planning", resumeExecute: false },
          { clearExecuteSession: 1 },
        ),
      ).toThrow("illegal state transition: failed -> planning");

      expect(store.getTask(task.id)!.state).toBe("failed");
      expect(store.executeSession(task.id, 1)).toBeDefined();
      expect(store.listEvents(task.id).map((e) => e.type)).toEqual(["created", "plan_revision"]);
    });
  });

  describe("transitionWithVerifyRun", () => {
    const run = {
      number: 1,
      result: "passed" as const,
      commands: ["npm run check"],
      failingCommand: null,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
    };

    it("inserts the row, appends verify_run, then one transition with the detail", () => {
      const task = store.createTask(newTask("executed"));
      transitionTask(store, task.id, "verifying");
      const moved = transitionWithVerifyRun(store, task.id, "awaiting_work_review", run, { note: "ok" });
      expect(moved.state).toBe("awaiting_work_review");
      expect(store.getVerifyRun(task.id, 1)?.result).toBe("passed");
      const events = store.listEvents(task.id);
      expect(events.map((e) => e.type)).toEqual(["created", "transition", "verify_run", "transition"]);
      expect(events[2].data).toEqual({ number: 1, result: "passed" });
      expect(events[3].data).toEqual({ note: "ok", from: "verifying", to: "awaiting_work_review" });
    });

    it("moves to failed with an error that failedFrom reads", () => {
      const task = store.createTask(newTask("executed"));
      transitionTask(store, task.id, "verifying");
      transitionWithVerifyRun(store, task.id, "failed", { ...run, result: "failed", failingCommand: 1 }, { error: "boom" });
      expect(store.getTask(task.id)!.state).toBe("failed");
      expect(store.listEvents(task.id).at(-1)?.data).toEqual({ error: "boom", from: "verifying", to: "failed" });
      expect(failedFrom(store, task.id)).toBe("verifying");
    });

    it("writes no row and no event for an illegal edge", () => {
      const task = store.createTask(newTask("executed"));
      expect(() => transitionWithVerifyRun(store, task.id, "awaiting_work_review", run)).toThrow(
        "illegal state transition: executed -> awaiting_work_review",
      );
      expect(store.getVerifyRun(task.id, 1)).toBeUndefined();
      expect(store.getTask(task.id)!.state).toBe("executed");
      expect(store.listEvents(task.id).map((e) => e.type)).toEqual(["created"]);
    });
  });

  describe("failTask", () => {
    it("moves a task to failed and records the error", () => {
      const task = store.createTask(newTask("planning"));
      failTask(store, task.id, "boom");
      expect(store.getTask(task.id)!.state).toBe("failed");
      expect(store.listEvents(task.id).at(-1)?.data).toEqual({
        from: "planning",
        to: "failed",
        error: "boom",
      });
    });

    it("deletes the run marker of a task in a spawning state, so a retry can run", () => {
      const task = store.createTask(newTask("approved"));
      transitionTask(store, task.id, "executing");
      expect(store.runStatus(task.id)).toEqual({ status: "running" });
      expect(failTask(store, task.id, "boom").state).toBe("failed");
      expect(transitionTask(store, task.id, "refining").state).toBe("refining");
      expect(store.runStatus(task.id)).toEqual({ status: "running" });
    });

    it("refuses a task that is already failed", () => {
      const task = store.createTask(newTask("planning"));
      failTask(store, task.id, "boom");
      const before = store.listEvents(task.id);
      expect(() => failTask(store, task.id, "again")).toThrow(
        "illegal state transition: failed -> failed",
      );
      expect(store.getTask(task.id)!.state).toBe("failed");
      expect(store.listEvents(task.id)).toEqual(before);
    });
  });

  describe("failedFrom", () => {
    it("gives the state that the task failed in", () => {
      const task = store.createTask(newTask("planning"));
      failTask(store, task.id, "boom");
      expect(failedFrom(store, task.id)).toBe("planning");
    });

    it("gives the state of the last failure", () => {
      const task = store.createTask(newTask("planning"));
      failTask(store, task.id, "boom");
      transitionTask(store, task.id, "refining");
      failTask(store, task.id, "boom again");
      expect(failedFrom(store, task.id)).toBe("refining");
    });

    it("gives undefined for a task in another state", () => {
      const task = store.createTask(newTask("planning"));
      expect(failedFrom(store, task.id)).toBeUndefined();
    });

    it("gives undefined for a missing task", () => {
      expect(failedFrom(store, 999)).toBeUndefined();
    });

    it("gives undefined for a task that left failed", () => {
      const task = store.createTask(newTask("planning"));
      failTask(store, task.id, "boom");
      transitionTask(store, task.id, "workspace_ready");
      expect(failedFrom(store, task.id)).toBeUndefined();
    });

    it("gives undefined for a task created in failed", () => {
      const task = store.createTask(newTask("failed"));
      expect(failedFrom(store, task.id)).toBeUndefined();
    });

    it("gives undefined when the last failure event has an invalid from", () => {
      const task = store.createTask(newTask("planning"));
      failTask(store, task.id, "boom");
      store.appendEvent(task.id, "transition", { from: "bogus", to: "failed" });
      expect(failedFrom(store, task.id)).toBeUndefined();
    });
  });

  describe("lastFailIndex", () => {
    it("gives -1 for events with no move into failed", () => {
      const task = store.createTask(newTask("planning"));
      store.appendEvent(task.id, "transition", { from: "planning", to: "refining" });
      expect(lastFailIndex(store.listEvents(task.id))).toBe(-1);
    });

    it("gives the index of the last of two moves into failed", () => {
      const task = store.createTask(newTask("planning"));
      failTask(store, task.id, "boom");
      transitionTask(store, task.id, "refining");
      failTask(store, task.id, "boom again");
      const events = store.listEvents(task.id);
      const fails = events.flatMap((event, i) => ((event.data as { to?: string } | undefined)?.to === "failed" ? [i] : []));
      expect(fails).toHaveLength(2);
      expect(lastFailIndex(events)).toBe(fails[1]);
    });
  });

  describe("failedFromEvents", () => {
    it("gives the from of the last move into failed", () => {
      const task = store.createTask(newTask("planning"));
      failTask(store, task.id, "boom");
      transitionTask(store, task.id, "refining");
      failTask(store, task.id, "boom again");
      expect(failedFromEvents(store.listEvents(task.id))).toBe("refining");
    });

    it("gives undefined for events with no move into failed", () => {
      const task = store.createTask(newTask("planning"));
      expect(failedFromEvents(store.listEvents(task.id))).toBeUndefined();
    });

    it("gives undefined when the last move has an invalid from, also when an older move has a valid one", () => {
      const task = store.createTask(newTask("planning"));
      failTask(store, task.id, "boom");
      store.appendEvent(task.id, "transition", { from: "bogus", to: "failed" });
      expect(failedFromEvents(store.listEvents(task.id))).toBeUndefined();
    });
  });
});
