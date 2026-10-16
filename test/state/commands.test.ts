import { describe, expect, it } from "vitest";
import { STATES, TERMINAL_STATES } from "../../src/state/machine.js";
import {
  acceptedStates,
  errorSentence,
  nextCell,
  showLines,
  stateCommands,
  type TaskCommand,
} from "../../src/state/commands.js";
import { helpText } from "../helpers/cli.js";
import { expectedStateCommands } from "../helpers/state-commands.js";
import { commandsInHelp } from "../skill-coverage.js";

const ACTIVE_STATES = STATES.filter((state) => !TERMINAL_STATES.has(state));

// The states that each command accepts, written by hand. The states do not change with the table.
const ACCEPTED: Record<TaskCommand, readonly string[]> = {
  start: ["provisioning"],
  plan: ["workspace_ready"],
  refine: ["awaiting_plan_review", "reviewed"],
  approve: ["awaiting_plan_review"],
  unapprove: ["approved"],
  execute: ["approved"],
  verify: ["executed"],
  review: ["awaiting_work_review"],
  "dismiss-review": ["reviewed"],
  accept: ["awaiting_work_review"],
  merge: ["accepted"],
  "mark-landed": ["accepted", "pushed", "in_peer_review"],
  finish: ["landed", "cleanup_failed"],
  retry: ["failed"],
  abort: ACTIVE_STATES,
};

describe("stateCommands", () => {
  it.each(ACTIVE_STATES)("has a row for %s", (state) => {
    expect(stateCommands(state)).toBeDefined();
  });

  it.each([...TERMINAL_STATES])("has no row for %s", (state) => {
    expect(stateCommands(state)).toBeUndefined();
  });

  it("has no row for an unknown state", () => {
    expect(stateCommands("nonsense")).toBeUndefined();
  });

  it.each(STATES)("gives the expected row for %s", (state) => {
    expect(stateCommands(state)).toEqual(expectedStateCommands(state));
  });

  it.each(ACTIVE_STATES)("puts the primary command first and abort last in the row of %s", (state) => {
    const row = stateCommands(state);
    expect(row?.commands.at(-1)).toBe("abort");
    if (row?.primary !== undefined) {
      expect(row.commands[0]).toBe(row.primary);
    }
  });

  it("names only commands that tasker --help lists", async () => {
    const listed = commandsInHelp(await helpText());
    const named = new Set(ACTIVE_STATES.flatMap((state) => stateCommands(state)?.commands ?? []));
    for (const name of named) {
      expect(listed).toContain(name);
    }
  });
});

describe("acceptedStates", () => {
  it.each(Object.entries(ACCEPTED))("gives the states that %s accepts, in the order of STATES", (command, states) => {
    expect(acceptedStates(command as TaskCommand)).toEqual(states);
  });
});

describe("showLines", () => {
  const key = "codeguru42/tasker#5";

  it("gives the next and also lines for a state with a primary command", () => {
    expect(showLines("approved", key)).toEqual([
      "next: tasker execute codeguru42/tasker#5",
      "also: tasker unapprove codeguru42/tasker#5, tasker abort codeguru42/tasker#5",
    ]);
  });

  it("gives one commands line for a state with no primary command", () => {
    expect(showLines("reviewed", key)).toEqual([
      "commands: tasker refine codeguru42/tasker#5, tasker dismiss-review codeguru42/tasker#5, tasker abort codeguru42/tasker#5",
    ]);
  });

  it("gives the abort line for a state that only aborts", () => {
    expect(showLines("executing", key)).toEqual(["commands: tasker abort codeguru42/tasker#5"]);
  });

  it.each(["finished", "cancelled", "nonsense"])("gives no line for %s", (state) => {
    expect(showLines(state, key)).toEqual([]);
  });
});

describe("nextCell", () => {
  it("gives the primary command and the other commands for a state with a primary command", () => {
    expect(nextCell("workspace_ready")).toBe("plan (also: abort)");
    expect(nextCell("approved")).toBe("execute (also: unapprove, abort)");
  });

  it("gives the commands for a state with no primary command", () => {
    expect(nextCell("awaiting_plan_review")).toBe("refine, approve, abort");
  });

  it("gives abort for a state that only aborts", () => {
    expect(nextCell("executing")).toBe("abort");
  });

  it.each(["finished", "cancelled", "nonsense"])("gives an empty string for %s", (state) => {
    expect(nextCell(state)).toBe("");
  });
});

describe("errorSentence", () => {
  const key = "codeguru42/tasker#5";

  it("gives the next command and the others for a state with a primary command", () => {
    expect(errorSentence("failed", key)).toBe(
      "next: tasker retry codeguru42/tasker#5 (also: tasker abort codeguru42/tasker#5)",
    );
  });

  it("gives the commands for a state with no primary command", () => {
    expect(errorSentence("awaiting_plan_review", key)).toBe(
      "commands: tasker refine codeguru42/tasker#5, tasker approve codeguru42/tasker#5, tasker abort codeguru42/tasker#5",
    );
  });

  it.each(["finished", "cancelled", "nonsense"])("gives nothing for %s", (state) => {
    expect(errorSentence(state, key)).toBeUndefined();
  });
});
