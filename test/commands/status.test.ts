import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli.js";
import { showConfig } from "../../src/commands/show-config.js";
import { loadConfig } from "../../src/config/load.js";
import { resolveIssueKey } from "../../src/issue-key/resolve.js";
import { status } from "../../src/commands/status.js";
import { STATES } from "../../src/state/machine.js";
import {
  captureIo,
  seedTasks,
  threeRepoConfig,
  validConfig,
  writeDataRootConfig,
  writeTempConfig,
} from "../helpers.js";

const TASKER = "codeguru42/tasker";
const OTHER = "codeguru42/other";
const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Writes the three repo configuration and points TASKER_CONFIG at it.
function setup() {
  const written = writeDataRootConfig(threeRepoConfig());
  dirs.push(written.dir);
  vi.stubEnv("TASKER_CONFIG", written.path);
  return written;
}

async function runStatus(...args: string[]) {
  const io = captureIo();
  const code = await run(["status", ...args], { commands: [status], io });
  return { code, out: io.out.join(""), err: io.err.join("") };
}

describe("status", () => {
  it("lists the active tasks of all repos and hides finished and cancelled tasks", async () => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: at(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: at(3) },
      { issueKey: `${TASKER}#1`, repoKey: TASKER, state: "finished", at: at(4) },
      { issueKey: `${OTHER}#2`, repoKey: OTHER, state: "cancelled", at: at(5) },
    ]);

    const result = await runStatus();

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO               STATE      UPDATED\n" +
        "codeguru42/other#7   codeguru42/other   executing  2026-01-03T00:00:00.000Z\n" +
        "codeguru42/tasker#5  codeguru42/tasker  planning   2026-01-02T00:00:00.000Z\n",
    });
  });

  it("prints the four columns, the newest change first and the higher id first on a tie", async () => {
    const { dataRoot } = setup();
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
        at: at(day),
      })),
    );

    const result = await runStatus();

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO               STATE      UPDATED\n" +
        "codeguru42/tasker#5  codeguru42/tasker  planning   2026-01-04T00:00:00.000Z\n" +
        "codeguru42/tasker#4  codeguru42/tasker  planning   2026-01-04T00:00:00.000Z\n" +
        "codeguru42/tasker#2  codeguru42/tasker  planning   2026-01-03T00:00:00.000Z\n" +
        "codeguru42/tasker#3  codeguru42/tasker  executing  2026-01-02T00:00:00.000Z\n" +
        "codeguru42/tasker#1  codeguru42/tasker  planning   2026-01-01T00:00:00.000Z\n",
    });
  });

  it.each([
    ["an empty store", []],
    [
      "a store with only finished and cancelled tasks",
      [
        { issueKey: `${TASKER}#1`, repoKey: TASKER, state: "finished", at: at(1) },
        { issueKey: `${OTHER}#2`, repoKey: OTHER, state: "cancelled", at: at(2) },
      ],
    ],
  ])("prints no tasks for %s", async (_name, tasks) => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, tasks);

    const result = await runStatus();

    expect(result).toEqual({ code: 0, err: "", out: "no tasks\n" });
  });

  it("prints no tasks when --repo names a repo without active tasks", async () => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: at(2) },
    ]);

    const result = await runStatus("--repo", OTHER);

    expect(result).toEqual({ code: 0, err: "", out: "no tasks\n" });
  });

  it("lists only the tasks of the repo that --repo names", async () => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: at(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: at(3) },
    ]);

    const result = await runStatus("--repo", TASKER);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO               STATE     UPDATED\n" +
        "codeguru42/tasker#5  codeguru42/tasker  planning  2026-01-02T00:00:00.000Z\n",
    });
  });

  it.each(["missing", "toString"])("rejects the unknown repo %s", async (key) => {
    const { dataRoot } = setup();

    const result = await runStatus("--repo", key);

    expect(result).toEqual({ code: 1, out: "", err: `repo key not found: ${key}\n` });
    expect(existsSync(join(dataRoot, "tasker.db"))).toBe(false);
  });

  it.each([
    [
      "finished",
      "ISSUE                REPO               STATE     UPDATED\n" +
        "codeguru42/tasker#1  codeguru42/tasker  finished  2026-01-04T00:00:00.000Z\n",
    ],
    [
      "cancelled",
      "ISSUE               REPO              STATE      UPDATED\n" +
        "codeguru42/other#2  codeguru42/other  cancelled  2026-01-05T00:00:00.000Z\n",
    ],
  ])("lists only the %s tasks for --state", async (state, out) => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#3`, repoKey: TASKER, state: "planning", at: at(3) },
      { issueKey: `${TASKER}#1`, repoKey: TASKER, state: "finished", at: at(4) },
      { issueKey: `${OTHER}#2`, repoKey: OTHER, state: "cancelled", at: at(5) },
    ]);

    const result = await runStatus("--state", state);

    expect(result).toEqual({ code: 0, err: "", out });
  });

  it("rejects an unknown state and lists the states", async () => {
    setup();

    const result = await runStatus("--state", "bogus");

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `unknown state: bogus (the states are: ${STATES.join(", ")})\n`,
    });
  });

  it("lists only the tasks that match both --repo and --state", async () => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: at(2) },
      { issueKey: `${TASKER}#6`, repoKey: TASKER, state: "executing", at: at(3) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "planning", at: at(4) },
    ]);

    const result = await runStatus("--repo", TASKER, "--state", "planning");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO               STATE     UPDATED\n" +
        "codeguru42/tasker#5  codeguru42/tasker  planning  2026-01-02T00:00:00.000Z\n",
    });
  });

  it("lists only the tasks of the issue that --issue names", async () => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: at(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: at(3) },
      { issueKey: `${OTHER}#8`, repoKey: OTHER, state: "planning", at: at(4) },
    ]);

    const result = await runStatus("--issue", `${OTHER}#7`);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE               REPO              STATE      UPDATED\n" +
        "codeguru42/other#7  codeguru42/other  executing  2026-01-03T00:00:00.000Z\n",
    });
  });

  it.each(["nobody/else#1", `${TASKER}#5`])(
    "prints the error of the issue key %s",
    async (key) => {
      const written = setup();
      let expected = "";
      try {
        resolveIssueKey(key, loadConfig({ TASKER_CONFIG: written.path }));
      } catch (error) {
        expected = `${(error as Error).message}\n`;
      }
      expect(expected).not.toBe("");

      const result = await runStatus("--issue", key);

      expect(result).toEqual({ code: 1, out: "", err: expected });
    },
  );

  it("passes --repo to the issue key, so that it picks one of two repos", async () => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: at(2) },
      { issueKey: `${TASKER}#5`, repoKey: "fork", state: "planning", at: at(3) },
    ]);

    const result = await runStatus("--issue", `${TASKER}#5`, "--repo", "fork");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE                REPO  STATE     UPDATED\n" +
        "codeguru42/tasker#5  fork  planning  2026-01-03T00:00:00.000Z\n",
    });
  });

  it("lists only the cancelled attempt of an issue for --issue with --state", async () => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "cancelled", at: at(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: at(3) },
    ]);

    const result = await runStatus("--issue", `${OTHER}#7`, "--state", "cancelled");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "ISSUE               REPO              STATE      UPDATED\n" +
        "codeguru42/other#7  codeguru42/other  cancelled  2026-01-02T00:00:00.000Z\n",
    });
  });

  describe("with a configuration error", () => {
    it.each([
      ["a missing file", (dir: string) => join(dir, "missing.json")],
      ["an invalid file", (_dir: string, path: string) => path],
    ])("prints the error of show-config for %s", async (_name, pick) => {
      const written = writeTempConfig({ ...validConfig(), bogus: 1 });
      dirs.push(written.dir);
      vi.stubEnv("TASKER_CONFIG", pick(written.dir, written.path));
      const showIo = captureIo();
      const showCode = await run(["show-config"], { commands: [showConfig], io: showIo });

      const result = await runStatus();

      expect(showCode).toBe(1);
      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err).not.toBe("");
      expect(result.err).toBe(showIo.err.join(""));
    });
  });
});
