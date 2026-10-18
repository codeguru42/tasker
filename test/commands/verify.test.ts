import { describe, expect, it } from "vitest";
import { verify } from "../../src/commands/verify.js";
import { transitionTask } from "../../src/state/machine.js";
import { verifyRunDir } from "../../src/store/layout.js";
import { updateBranch } from "../../src/commands/update-branch.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { latestTaskOf, withDataRootStore } from "../helpers/store.js";
import { expectCommandRefused, landParent, useStackedTasks, useVerifyFixture } from "../helpers/task-fixtures.js";
import { wrongStateError } from "../helpers/state-commands.js";

const KEY = "codeguru42/tasker#5";

const runVerify = (key = KEY, ...extra: string[]) => runCommand(verify, "verify", key, ...extra);

describe("tasker verify", () => {
  it("prints the run, the command count and the logs folder of a pass", async () => {
    const fixture = await useVerifyFixture({ commands: ["true", "echo hi"] });

    const result = await runVerify();

    expect(result).toEqual({
      code: 0,
      out: [
        `verified ${KEY}: run 1`,
        "commands: 2",
        `logs: ${verifyRunDir(fixture.started.dataRoot, fixture.task, 1)}`,
        "",
      ].join("\n"),
      err: "",
    });
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("awaiting_work_review");
  });

  it("refuses a task that is not in executed, with the message on stderr and no state change", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    withDataRootStore(fixture.started.dataRoot, (store) => transitionTask(store, fixture.task.id, "updating_branch"));

    const result = await runVerify();

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `${wrongStateError("updating_branch", KEY, "verify", "executed")}\n`,
    });
    expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("updating_branch");
  });

  it("refuses a stacked task whose parent landed until update-branch moves it", async () => {
    const fixture = await useStackedTasks({ repo: { verify: { commands: ["true"], env: [] } } });
    await landParent(fixture, ["accepted", "landed"]);
    const key = fixture.stacked.key;

    await expectCommandRefused(
      { dataRoot: fixture.dataRoot, key },
      () => runVerify(key),
      `the parent ${fixture.parent.key} of ${key} has landed; run tasker update-branch ${key} to move the task onto main first\n`,
    );

    expect((await runCommand(updateBranch, "update-branch", key)).code).toBe(0);
    expect((await runVerify(key)).code).toBe(0);
    expect(latestTaskOf(fixture.dataRoot, key).state).toBe("awaiting_work_review");
  });

  it("prints the description of the command and of --repo for --help", async () => {
    const { code, help } = await runHelp(verify, "verify");

    expect(code).toBe(0);
    expect(help).toContain(
      "Run the verify commands of the repo in the worktree of a task in executed and record the run: the task goes through verifying to awaiting_work_review, or to failed",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
