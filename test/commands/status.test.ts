import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../../src/cli.js";
import { showConfig } from "../../src/commands/show-config.js";
import { status } from "../../src/commands/status.js";
import { STATES } from "../../src/state/machine.js";
import { captureIo, runCommand } from "../helpers/cli.js";
import { issueKeyErrorMessage, useConfigFile, useThreeRepoDataRoot, validConfig } from "../helpers/config.js";
import { dayAt, seedDeadRun, seedTasks } from "../helpers/store.js";
import { deadRunNote } from "../helpers/state-commands.js";
import { useProcessEnv } from "../helpers/temp.js";

const TASKER = "codeguru42/tasker";
const OTHER = "codeguru42/other";

describe("status", () => {
  it("lists the active tasks of all repos and hides finished and cancelled tasks", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: dayAt(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: dayAt(3) },
      { issueKey: `${TASKER}#1`, repoKey: TASKER, state: "finished", at: dayAt(4) },
      { issueKey: `${OTHER}#2`, repoKey: OTHER, state: "cancelled", at: dayAt(5) },
    ]);

    const result = await runCommand(status, "status");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO               STATE      UPDATED                   NEXT\n" +
        "codeguru42/other#7   codeguru42/other   executing  2026-01-03T00:00:00.000Z  abort\n" +
        "codeguru42/tasker#5  codeguru42/tasker  planning   2026-01-02T00:00:00.000Z  abort\n",
    });
  });

  it("moves a task with a dead run to interrupted, lists it and writes the note on stderr", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [dead] = seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "approved", at: dayAt(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: dayAt(3) },
    ]);
    seedDeadRun(dataRoot, dead.id, "executing");

    const result = await runCommand(status, "status", "--state", "interrupted");

    expect(result.code).toBe(0);
    expect(result.err).toBe(`${deadRunNote(`${TASKER}#5`, "executing")}\n`);
    const rows = result.out.trimEnd().split("\n").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^codeguru42\/tasker#5 +codeguru42\/tasker +interrupted +\S+ +resume \(also: abort\)$/);
  });

  it("prints the five columns, the newest change first and the higher id first on a tie", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(
      dataRoot,
      [
        { n: 1, state: "planning", day: 1 },
        { n: 2, state: "planning", day: 3 },
        { n: 3, state: "executing", day: 2 },
        { n: 4, state: "planning", day: 4 },
        { n: 5, state: "planning", day: 4 },
      ].map(({ n, state, day }) => ({
        issueKey: `${TASKER}#${n}`,
        repoKey: TASKER,
        state,
        at: dayAt(day),
      })),
    );

    const result = await runCommand(status, "status");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO               STATE      UPDATED                   NEXT\n" +
        "codeguru42/tasker#5  codeguru42/tasker  planning   2026-01-04T00:00:00.000Z  abort\n" +
        "codeguru42/tasker#4  codeguru42/tasker  planning   2026-01-04T00:00:00.000Z  abort\n" +
        "codeguru42/tasker#2  codeguru42/tasker  planning   2026-01-03T00:00:00.000Z  abort\n" +
        "codeguru42/tasker#3  codeguru42/tasker  executing  2026-01-02T00:00:00.000Z  abort\n" +
        "codeguru42/tasker#1  codeguru42/tasker  planning   2026-01-01T00:00:00.000Z  abort\n",
    });
  });

  it.each([
    ["an empty store", []],
    [
      "a store with only finished and cancelled tasks",
      [
        { issueKey: `${TASKER}#1`, repoKey: TASKER, state: "finished", at: dayAt(1) },
        { issueKey: `${OTHER}#2`, repoKey: OTHER, state: "cancelled", at: dayAt(2) },
      ],
    ],
  ])("prints no tasks for %s", async (_name, tasks) => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, tasks);

    const result = await runCommand(status, "status");

    expect(result).toEqual({ code: 0, err: "", out: "no tasks\n" });
  });

  it("prints no tasks when --repo names a repo without active tasks", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [{ issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: dayAt(2) }]);

    const result = await runCommand(status, "status", "--repo", OTHER);

    expect(result).toEqual({ code: 0, err: "", out: "no tasks\n" });
  });

  it("prints the next commands of the state in the last column", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "workspace_ready", at: dayAt(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "awaiting_plan_review", at: dayAt(3) },
    ]);

    const result = await runCommand(status, "status");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO               STATE                 UPDATED                   NEXT\n" +
        "codeguru42/other#7   codeguru42/other   awaiting_plan_review  2026-01-03T00:00:00.000Z  refine, approve, abort\n" +
        "codeguru42/tasker#5  codeguru42/tasker  workspace_ready       2026-01-02T00:00:00.000Z  plan (also: abort)\n",
    });
  });

  it("names update-branch in the next commands of a task in awaiting_work_review", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [{ issueKey: `${TASKER}#5`, repoKey: TASKER, state: "awaiting_work_review", at: dayAt(2) }]);

    const result = await runCommand(status, "status");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO               STATE                 UPDATED                   NEXT\n" +
        "codeguru42/tasker#5  codeguru42/tasker  awaiting_work_review  2026-01-02T00:00:00.000Z  review, accept, update-branch, abort\n",
    });
  });

  it("lists only the tasks of the repo that --repo names", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: dayAt(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: dayAt(3) },
    ]);

    const result = await runCommand(status, "status", "--repo", TASKER);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO               STATE     UPDATED                   NEXT\n" +
        "codeguru42/tasker#5  codeguru42/tasker  planning  2026-01-02T00:00:00.000Z  abort\n",
    });
  });

  it.each(["missing", "toString"])("rejects the unknown repo %s", async (key) => {
    const { dataRoot } = useThreeRepoDataRoot();

    const result = await runCommand(status, "status", "--repo", key);

    expect(result).toEqual({ code: 1, out: "", err: `repo key not found: ${key}\n` });
    expect(existsSync(join(dataRoot, "tasker.db"))).toBe(false);
  });

  it.each([
    [
      "finished",
      "ISSUE                REPO               STATE     UPDATED                   NEXT\n" +
        "codeguru42/tasker#1  codeguru42/tasker  finished  2026-01-04T00:00:00.000Z\n",
    ],
    [
      "cancelled",
      "ISSUE               REPO              STATE      UPDATED                   NEXT\n" +
        "codeguru42/other#2  codeguru42/other  cancelled  2026-01-05T00:00:00.000Z\n",
    ],
  ])("lists only the %s tasks for --state", async (state, out) => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#3`, repoKey: TASKER, state: "planning", at: dayAt(3) },
      { issueKey: `${TASKER}#1`, repoKey: TASKER, state: "finished", at: dayAt(4) },
      { issueKey: `${OTHER}#2`, repoKey: OTHER, state: "cancelled", at: dayAt(5) },
    ]);

    const result = await runCommand(status, "status", "--state", state);

    expect(result).toEqual({ code: 0, err: "", out });
  });

  it("rejects an unknown state and lists the states", async () => {
    useThreeRepoDataRoot();

    const result = await runCommand(status, "status", "--state", "bogus");

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `unknown state: bogus (the states are: ${STATES.join(", ")})\n`,
    });
  });

  it("lists only the tasks that match both --repo and --state", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: dayAt(2) },
      { issueKey: `${TASKER}#6`, repoKey: TASKER, state: "executing", at: dayAt(3) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "planning", at: dayAt(4) },
    ]);

    const result = await runCommand(status, "status", "--repo", TASKER, "--state", "planning");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO               STATE     UPDATED                   NEXT\n" +
        "codeguru42/tasker#5  codeguru42/tasker  planning  2026-01-02T00:00:00.000Z  abort\n",
    });
  });

  it("lists only the tasks of the issue that --issue names", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: dayAt(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: dayAt(3) },
      { issueKey: `${OTHER}#8`, repoKey: OTHER, state: "planning", at: dayAt(4) },
    ]);

    const result = await runCommand(status, "status", "--issue", `${OTHER}#7`);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE               REPO              STATE      UPDATED                   NEXT\n" +
        "codeguru42/other#7  codeguru42/other  executing  2026-01-03T00:00:00.000Z  abort\n",
    });
  });

  it.each(["nobody/else#1", `${TASKER}#5`])("prints the error of the issue key %s", async (key) => {
    const written = useThreeRepoDataRoot();
    const expected = `${issueKeyErrorMessage(key, written.path)}\n`;

    const result = await runCommand(status, "status", "--issue", key);

    expect(result).toEqual({ code: 1, out: "", err: expected });
  });

  it("passes --repo to the issue key, so that it picks one of two repos", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: dayAt(2) },
      { issueKey: `${TASKER}#5`, repoKey: "fork", state: "planning", at: dayAt(3) },
    ]);

    const result = await runCommand(status, "status", "--issue", `${TASKER}#5`, "--repo", "fork");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO  STATE     UPDATED                   NEXT\n" +
        "codeguru42/tasker#5  fork  planning  2026-01-03T00:00:00.000Z  abort\n",
    });
  });

  it("lists only the cancelled attempt of an issue for --issue with --state", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "cancelled", at: dayAt(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: dayAt(3) },
    ]);

    const result = await runCommand(status, "status", "--issue", `${OTHER}#7`, "--state", "cancelled");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE               REPO              STATE      UPDATED                   NEXT\n" +
        "codeguru42/other#7  codeguru42/other  cancelled  2026-01-02T00:00:00.000Z\n",
    });
  });

  describe("with a configuration error", () => {
    it.each([
      ["a missing file", (dir: string) => join(dir, "missing.json")],
      ["an invalid file", (_dir: string, path: string) => path],
    ])("prints the error of show-config for %s", async (_name, pick) => {
      const written = useConfigFile(() => JSON.stringify({ ...validConfig(), bogus: 1 }));
      useProcessEnv({ TASKER_CONFIG: pick(written.dir, written.path) });
      const showIo = captureIo();
      const showCode = await run(["show-config"], { commands: [showConfig], io: showIo });

      const result = await runCommand(status, "status");

      expect(showCode).toBe(1);
      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).not.toBe("");
      expect(result.err).toBe(showIo.err.join(""));
    });
  });
});
