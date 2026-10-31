import { describe, expect, it } from "vitest";
import { abort } from "../../src/commands/abort.js";
import { finish } from "../../src/commands/finish.js";
import { start } from "../../src/commands/start.js";
import { runCommand } from "../helpers/cli.js";
import {
  acliWriteResult,
  assignArgs,
  AUTH_STATUS_ARGS,
  BACKLOG_ISSUE_VIEW,
  fakeAcli,
  type FakeAcli,
  issueViewArgs,
  linksViewArgs,
  MEASURED_AUTH_STATUS,
  NO_LINKS_VIEW,
  transitionArgs,
} from "../helpers/fake-acli.js";
import { eventDataOf, latestTaskOf, placeTask, withDataRootStore } from "../helpers/store.js";
import { useStartFixture } from "../helpers/task-fixtures.js";
import { useProcessEnv, useTempDir } from "../helpers/temp.js";

// The setup of a test of a Jira repo: a start fixture with a jira tracker and a fake acli that answers the calls
// of tasker start and tasker finish for TEST-5.
async function useJiraTask(): Promise<{ dataRoot: string; acli: FakeAcli }> {
  const fixture = await useStartFixture({
    repo: {
      issueTracker: {
        provider: "jira",
        project: "TEST",
        updateOnStart: true,
        updateOnFinish: true,
        inProgressStatus: "In Progress",
        doneStatus: "Done",
      },
    },
  });
  const acli = fakeAcli(useTempDir("tasker-jira-"), {}, [
    { args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS },
    { args: issueViewArgs("TEST-5"), stdout: BACKLOG_ISSUE_VIEW },
    { args: linksViewArgs("TEST-5"), stdout: NO_LINKS_VIEW },
    { args: assignArgs("TEST-5", "@me"), stdout: acliWriteResult("SUCCESS", "assigned") },
    { args: transitionArgs("TEST-5", "In Progress"), stdout: acliWriteResult("SUCCESS", "moved") },
    { args: transitionArgs("TEST-5", "Done"), stdout: acliWriteResult("SUCCESS", "moved") },
  ]);
  useProcessEnv({ TASKER_ACLI_BIN: String(acli.env.TASKER_ACLI_BIN) });
  return { dataRoot: fixture.dataRoot, acli };
}

const argsOf = (acli: FakeAcli) => acli.calls().map((call) => call.args);

describe("a Jira repo", () => {
  it("tasker start reads the issue and writes to the tracker", async () => {
    const { dataRoot, acli } = await useJiraTask();

    const { code, out } = await runCommand(start, "start", "TEST-5");

    expect(code).toBe(0);
    expect(argsOf(acli)).toEqual([
      AUTH_STATUS_ARGS,
      issueViewArgs("TEST-5"),
      AUTH_STATUS_ARGS,
      linksViewArgs("TEST-5"),
      AUTH_STATUS_ARGS,
      assignArgs("TEST-5", "@me"),
      AUTH_STATUS_ARGS,
      transitionArgs("TEST-5", "In Progress"),
    ]);
    expect(out).toContain("assigned TEST-5 to @me on the tracker\nmarked TEST-5 in progress on the tracker\n");
    expect(eventDataOf(dataRoot, "TEST-5", "tracker_update")).toEqual([
      { action: "assign", result: "ok" },
      { action: "in_progress", result: "ok" },
    ]);
  });

  it("tasker finish moves the issue to the done status", async () => {
    const { dataRoot, acli } = await useJiraTask();
    await runCommand(start, "start", "TEST-5");
    const before = acli.calls().length;
    withDataRootStore(dataRoot, (store) => placeTask(store, latestTaskOf(dataRoot, "TEST-5").id, "landed"));

    const { code } = await runCommand(finish, "finish", "TEST-5");

    expect(code).toBe(0);
    expect(argsOf(acli).slice(before)).toEqual([AUTH_STATUS_ARGS, transitionArgs("TEST-5", "Done")]);
    const updates = eventDataOf(dataRoot, "TEST-5", "tracker_update");
    expect(updates.at(-1)).toEqual({ action: "done", result: "ok" });
    expect(updates.filter((data) => (data as { action: string }).action === "done")).toHaveLength(1);
  });

  it("tasker abort makes no call to the tracker", async () => {
    const { dataRoot, acli } = await useJiraTask();
    await runCommand(start, "start", "TEST-5");
    const before = acli.calls().length;

    const { code, out } = await runCommand(abort, "abort", "TEST-5");

    expect(code).toBe(0);
    expect(acli.calls()).toHaveLength(before);
    expect(out).not.toContain("on the tracker");
    expect(eventDataOf(dataRoot, "TEST-5", "tracker_update")).toEqual([
      { action: "assign", result: "ok" },
      { action: "in_progress", result: "ok" },
    ]);
  });
});
