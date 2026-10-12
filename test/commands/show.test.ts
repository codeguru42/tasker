import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli.js";
import { show } from "../../src/commands/show.js";
import { loadConfig } from "../../src/config/load.js";
import { resolveIssueKey } from "../../src/issue-key/resolve.js";
import { captureIo, seedTasks, threeRepoConfig, writeDataRootConfig } from "../helpers.js";

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

async function runShow(...args: string[]) {
  const io = captureIo();
  const code = await run(["show", ...args], { commands: [show], io });
  return { code, out: io.out.join(""), err: io.err.join("") };
}

describe("show", () => {
  it("prints the fields of a task in workspace_ready", async () => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      {
        issueKey: `${TASKER}#5`,
        repoKey: TASKER,
        state: "workspace_ready",
        at: at(2),
        title: "Add tasker show",
        base: "main",
        branch: "issue-5-add-tasker-show",
        worktreePath: "/tmp/wt/issue-5",
      },
    ]);

    const result = await runShow(`${TASKER}#5`);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "issue: codeguru42/tasker#5\n" +
        "repo: codeguru42/tasker\n" +
        "title: Add tasker show\n" +
        "state: workspace_ready\n" +
        "attempt: 1\n" +
        "base: main\n" +
        "branch: issue-5-add-tasker-show\n" +
        "worktree: /tmp/wt/issue-5\n" +
        "created: 2026-01-02T00:00:00.000Z\n" +
        "updated: 2026-01-02T00:00:00.000Z\n" +
        'last event: 2026-01-02T00:00:00.000Z created {"state":"workspace_ready"}\n',
    });
  });

  it("prints the active task of an issue that also has a cancelled task", async () => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "cancelled", at: at(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: at(3) },
    ]);

    const result = await runShow(`${OTHER}#7`);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "issue: codeguru42/other#7\n" +
        "repo: codeguru42/other\n" +
        "title: -\n" +
        "state: executing\n" +
        "attempt: 2\n" +
        "base: -\n" +
        "branch: -\n" +
        "worktree: -\n" +
        "created: 2026-01-03T00:00:00.000Z\n" +
        "updated: 2026-01-03T00:00:00.000Z\n" +
        'last event: 2026-01-03T00:00:00.000Z created {"state":"executing"}\n',
    });
  });

  it("prints an error for an issue with no task", async () => {
    setup();

    const result = await runShow(`${OTHER}#9`);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: "no task for the issue codeguru42/other#9 in the repo codeguru42/other\n",
    });
  });

  it.each(["nobody/else#1", `${TASKER}#5`])(
    "prints the error of the issue key %s and opens no store",
    async (key) => {
      const written = setup();
      let expected = "";
      try {
        resolveIssueKey(key, loadConfig({ TASKER_CONFIG: written.path }));
      } catch (error) {
        expected = `${(error as Error).message}\n`;
      }
      expect(expected).not.toBe("");

      const result = await runShow(key);

      expect(result).toEqual({ code: 1, out: "", err: expected });
      expect(existsSync(join(written.dataRoot, "tasker.db"))).toBe(false);
    },
  );

  it("passes --repo to the issue key, so that it picks one of two repos", async () => {
    const { dataRoot } = setup();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: at(2) },
      { issueKey: `${TASKER}#5`, repoKey: "fork", state: "planning", at: at(3) },
    ]);

    const result = await runShow(`${TASKER}#5`, "--repo", "fork");

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "issue: codeguru42/tasker#5\n" +
        "repo: fork\n" +
        "title: -\n" +
        "state: planning\n" +
        "attempt: 2\n" +
        "base: -\n" +
        "branch: -\n" +
        "worktree: -\n" +
        "created: 2026-01-03T00:00:00.000Z\n" +
        "updated: 2026-01-03T00:00:00.000Z\n" +
        'last event: 2026-01-03T00:00:00.000Z created {"state":"planning"}\n',
    });
  });

  it("prints the description of the command and of --repo for --help", async () => {
    const io = captureIo();

    const code = await run(["show", "--help"], { commands: [show], io });

    expect(code).toBe(0);
    const help = io.out.join("");
    expect(help).toContain(
      "Print the details of the task of an issue: the active task, else the newest one",
    );
    expect(help).toContain(
      "Use the repo with this key when two repos share the project of the issue",
    );
  });
});
