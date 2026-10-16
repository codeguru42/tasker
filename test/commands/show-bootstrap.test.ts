import { mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { showBootstrap } from "../../src/commands/show-bootstrap.js";
import { bootstrapLogPath } from "../../src/phases/bootstrap.js";
import { taskLogsDir } from "../../src/store/layout.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { useThreeRepoDataRoot } from "../helpers/config.js";
import { dayAt, seedTasks, writeBootstrapLog } from "../helpers/store.js";

const TASKER = "codeguru42/tasker";
const OTHER = "codeguru42/other";

describe("show-bootstrap", () => {
  it("prints a log with two runs as it is", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "workspace_ready", at: dayAt(2) },
    ]);
    const log =
      "=== bootstrap run 2026-01-02T00:00:00.000Z ===\n" +
      "$ npm ci\n" +
      "added 1 package \n" +
      "\n" +
      "--- exit code 1\n" +
      "=== bootstrap run 2026-01-03T00:00:00.000Z ===\n" +
      "$ npm ci\n" +
      "--- exit code 0";
    writeBootstrapLog(dataRoot, task, log);

    const result = await runCommand(showBootstrap, "show-bootstrap", `${TASKER}#5`, "--repo", TASKER);

    expect(result).toEqual({ code: 0, err: "", out: log });
  });

  it("prints nothing for an empty log", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "workspace_ready", at: dayAt(2) },
    ]);
    writeBootstrapLog(dataRoot, task, "");

    const result = await runCommand(showBootstrap, "show-bootstrap", `${TASKER}#5`, "--repo", TASKER);

    expect(result).toEqual({ code: 0, out: "", err: "" });
  });

  it("prints an error for a task with no bootstrap log", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedTasks(dataRoot, [{ issueKey: `${TASKER}#5`, repoKey: TASKER, state: "workspace_ready", at: dayAt(2) }]);

    const result = await runCommand(showBootstrap, "show-bootstrap", `${TASKER}#5`, "--repo", TASKER);

    expect(result).toEqual({ code: 1, out: "", err: "no bootstrap log for codeguru42/tasker#5\n" });
  });

  it("prints the error code when the log cannot be read", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "workspace_ready", at: dayAt(2) },
    ]);
    mkdirSync(bootstrapLogPath(taskLogsDir(dataRoot, task)), { recursive: true });

    const result = await runCommand(showBootstrap, "show-bootstrap", `${TASKER}#5`, "--repo", TASKER);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: "cannot read the bootstrap log for codeguru42/tasker#5: EISDIR\n",
    });
  });

  it("prints an error for an issue with no task", async () => {
    useThreeRepoDataRoot();

    const result = await runCommand(showBootstrap, "show-bootstrap", `${OTHER}#9`);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: "no task for the issue codeguru42/other#9 in the repo codeguru42/other\n",
    });
  });

  it("passes --repo to the issue key, so that it picks one of two repos", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [first, second] = seedTasks(dataRoot, [
      { issueKey: `${TASKER}#5`, repoKey: TASKER, state: "workspace_ready", at: dayAt(2) },
      { issueKey: `${TASKER}#5`, repoKey: "fork", state: "workspace_ready", at: dayAt(3) },
    ]);
    writeBootstrapLog(dataRoot, first, "tasker log\n");
    writeBootstrapLog(dataRoot, second, "fork log\n");

    const result = await runCommand(showBootstrap, "show-bootstrap", `${TASKER}#5`, "--repo", "fork");

    expect(result).toEqual({ code: 0, err: "", out: "fork log\n" });
  });

  it("prints the log of the active task of an issue that also has a cancelled task", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [cancelled, active] = seedTasks(dataRoot, [
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "cancelled", at: dayAt(2) },
      { issueKey: `${OTHER}#7`, repoKey: OTHER, state: "executing", at: dayAt(3) },
    ]);
    writeBootstrapLog(dataRoot, cancelled, "old log\n");
    writeBootstrapLog(dataRoot, active, "new log\n");

    const result = await runCommand(showBootstrap, "show-bootstrap", `${OTHER}#7`);

    expect(result).toEqual({ code: 0, err: "", out: "new log\n" });
  });

  it("prints the description of the command and of --repo for --help", async () => {
    const { code, help } = await runHelp(showBootstrap, "show-bootstrap");

    expect(code).toBe(0);
    expect(help).toContain("Print the bootstrap log of the task of an issue: the active task, else the newest one");
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
