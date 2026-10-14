import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SPAWNING_STATES,
  STATES,
  TERMINAL_STATES,
  canTransition,
  enterSpawningState,
  failTask,
  failedFrom,
  leaveSpawningState,
  isSpawningState,
  isTaskState,
  transitionTask,
  type TaskState,
  type TransitionDetail,
} from "../../src/state/machine.js";
import { openStore, type TaskStore } from "../../src/store/store.js";
import { makeTempDir } from "../helpers.js";

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
    dir = makeTempDir("tasker-data-");
    store = openStore(join(dir, "tasker.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
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

  describe("enterSpawningState and leaveSpawningState", () => {
    it("enters a spawning state, writes the run marker and a transition event", () => {
      const task = store.createTask(newTask("approved"));
      const moved = enterSpawningState(store, task.id, "executing");
      expect(moved.state).toBe("executing");
      expect(store.getTask(task.id)!.state).toBe("executing");
      expect(store.runStatus(task.id)).toEqual({ status: "running" });
      expect(store.listEvents(task.id).at(-1)).toMatchObject({
        type: "transition",
        data: { from: "approved", to: "executing" },
      });
    });

    it("refuses an illegal edge into a spawning state and writes no marker", () => {
      const task = store.createTask(newTask("workspace_ready"));
      const before = store.listEvents(task.id);
      expect(() => enterSpawningState(store, task.id, "executing")).toThrow(
        "illegal state transition: workspace_ready -> executing",
      );
      expect(store.getTask(task.id)!.state).toBe("workspace_ready");
      expect(store.listEvents(task.id)).toEqual(before);
      expect(enterSpawningState(store, task.id, "planning").state).toBe("planning");
    });

    it("leaves a spawning state, deletes the run marker and writes a transition event", () => {
      const task = store.createTask(newTask("approved"));
      enterSpawningState(store, task.id, "executing");
      const moved = leaveSpawningState(store, task.id, "executed");
      expect(moved.state).toBe("executed");
      expect(store.getTask(task.id)!.state).toBe("executed");
      expect(store.listEvents(task.id).at(-1)).toMatchObject({
        type: "transition",
        data: { from: "executing", to: "executed" },
      });
      expect(enterSpawningState(store, task.id, "verifying").state).toBe("verifying");
    });

    it("refuses an illegal edge out of a spawning state and keeps the run marker", () => {
      const task = store.createTask(newTask("approved"));
      enterSpawningState(store, task.id, "executing");
      const before = store.listEvents(task.id);
      expect(() => leaveSpawningState(store, task.id, "approved")).toThrow(
        "illegal state transition: executing -> approved",
      );
      expect(store.getTask(task.id)!.state).toBe("executing");
      expect(store.runStatus(task.id)).toEqual({ status: "running" });
      expect(store.listEvents(task.id)).toEqual(before);
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
});
