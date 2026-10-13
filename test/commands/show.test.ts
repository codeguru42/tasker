import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { show } from "../../src/commands/show.js";
import { dayAt, issueKeyErrorMessage, runCommand, seedTasks, useThreeRepoDataRoot } from "../helpers.js";

const TASKER = "codeguru42/tasker";
const OTHER = "codeguru42/other";

describe("show", () => {
  it("prints the fields of a task in workspace_ready", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      {
        issueKey: `${TASKER}#5`,
        repoKey: TASKER,
        state: "workspace_ready",
        at: dayAt(2),
        title: "Add tasker show",
        base: "main",
        branch: "issue-5-add-tasker-show",
        worktreePath: "/tmp/wt/issue-5",
      },
    ]);

    const result = await runCommand(show, "show", `${TASKER}#5`, "--repo", TASKER);

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
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "cancelled", at: dayAt(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: dayAt(3) },
    ]);

    const result = await runCommand(show, "show", `${OTHER}#7`);

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
    useThreeRepoDataRoot();

    const result = await runCommand(show, "show", `${OTHER}#9`);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: "no task for the issue codeguru42/other#9 in the repo codeguru42/other\n",
    });
  });

  it.each(["nobody/else#1", `${TASKER}#5`])(
    "prints the error of the issue key %s and opens no store",
    async (key) => {
      const written = useThreeRepoDataRoot();
      const expected = `${issueKeyErrorMessage(key, written.path)}\n`;

      const result = await runCommand(show, "show", key);

      expect(result).toEqual({ code: 1, out: "", err: expected });
      expect(existsSync(join(written.dataRoot, "tasker.db"))).toBe(false);
    },
  );

  it("passes --repo to the issue key, so that it picks one of two repos", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "planning", at: dayAt(2) },
      { issueKey: `${TASKER}#5`, repoKey: "fork", state: "planning", at: dayAt(3) },
    ]);

    const result = await runCommand(show, "show", `${TASKER}#5`, "--repo", "fork");

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

  it("prints the failure of a failed task", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      {
        issueKey: `${TASKER}#5`,
        repoKey: TASKER,
        state: "executing",
        at: dayAt(4),
        failWith: "git push failed",
      },
    ]);

    const result = await runCommand(show, "show", `${TASKER}#5`, "--repo", TASKER);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "issue: codeguru42/tasker#5\n" +
        "repo: codeguru42/tasker\n" +
        "title: -\n" +
        "state: failed\n" +
        "attempt: 1\n" +
        "base: -\n" +
        "branch: -\n" +
        "worktree: -\n" +
        "created: 2026-01-04T00:00:00.000Z\n" +
        "updated: 2026-01-04T00:00:00.000Z\n" +
        'last event: 2026-01-04T00:00:00.000Z transition {"error":"git push failed","from":"executing","to":"failed"}\n' +
        "failed in: executing\n" +
        "error: git push failed\n",
    });
  });

  it("prints each line end in a value as the two characters \\n", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [
      {
        issueKey: `${TASKER}#5`,
        repoKey: TASKER,
        state: "executing",
        at: dayAt(4),
        failWith: "git push failed\r\nexit 128\rdone\nend",
      },
    ]);

    const result = await runCommand(show, "show", `${TASKER}#5`, "--repo", TASKER);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        "issue: codeguru42/tasker#5\n" +
        "repo: codeguru42/tasker\n" +
        "title: -\n" +
        "state: failed\n" +
        "attempt: 1\n" +
        "base: -\n" +
        "branch: -\n" +
        "worktree: -\n" +
        "created: 2026-01-04T00:00:00.000Z\n" +
        "updated: 2026-01-04T00:00:00.000Z\n" +
        'last event: 2026-01-04T00:00:00.000Z transition {"error":"git push failed\\r\\nexit 128\\rdone\\nend","from":"executing","to":"failed"}\n' +
        "failed in: executing\n" +
        "error: git push failed\\nexit 128\\ndone\\nend\n",
    });
  });

  it("prints the description of the command and of --repo for --help", async () => {
    const { code, out } = await runCommand(show, "show", "--help");

    expect(code).toBe(0);
    // Commander wraps the long lines of the help, so compare with single spaces.
    const help = out.replace(/\s+/g, " ");
    expect(help).toContain(
      "Print the details of the task of an issue: the active task, else the newest one",
    );
    expect(help).toContain(
      "Use the repo with this key when two repos share the project of the issue",
    );
  });
});
