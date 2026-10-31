import { describe, expect, it } from "vitest";
import { abort } from "../../src/commands/abort.js";
import { finish } from "../../src/commands/finish.js";
import { start } from "../../src/commands/start.js";
import { runCommand } from "../helpers/cli.js";
import {
  acliWriteResult,
  AUTH_STATUS_ARGS,
  type FakeAcli,
  fakeAcli,
  MEASURED_AUTH_STATUS,
} from "../helpers/fake-acli.js";
import { eventDataOf, latestTaskOf, placeTask, withDataRootStore } from "../helpers/store.js";
import { useStartFixture } from "../helpers/task-fixtures.js";
import { useProcessEnv, useTempDir } from "../helpers/temp.js";

const VIEW_ARGS = [
  "jira",
  "workitem",
  "view",
  "TEST-5",
  "--json",
  "--fields",
  "summary,description,labels,status,components",
];
const LINKS_ARGS = ["jira", "workitem", "view", "TEST-5", "--json", "--fields", "issuelinks"];
const ASSIGN_ARGS = ["jira", "workitem", "assign", "--key", "TEST-5", "--assignee", "@me", "--yes", "--json"];
const transitionArgs = (status: string) => [
  "jira",
  "workitem",
  "transition",
  "--key",
  "TEST-5",
  "--status",
  status,
  "--yes",
  "--json",
];

const ISSUE_JSON = JSON.stringify({
  fields: {
    summary: "Issue 5",
    description: null,
    labels: [],
    components: [],
    status: { name: "Backlog", statusCategory: { key: "new" } },
  },
});

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
    { args: VIEW_ARGS, stdout: ISSUE_JSON },
    { args: LINKS_ARGS, stdout: '{"fields":{"issuelinks":[]}}' },
    { args: ASSIGN_ARGS, stdout: acliWriteResult("SUCCESS", "assigned") },
    { args: transitionArgs("In Progress"), stdout: acliWriteResult("SUCCESS", "moved") },
    { args: transitionArgs("Done"), stdout: acliWriteResult("SUCCESS", "moved") },
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
      VIEW_ARGS,
      AUTH_STATUS_ARGS,
      LINKS_ARGS,
      AUTH_STATUS_ARGS,
      ASSIGN_ARGS,
      AUTH_STATUS_ARGS,
      transitionArgs("In Progress"),
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
    expect(argsOf(acli).slice(before)).toEqual([AUTH_STATUS_ARGS, transitionArgs("Done")]);
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
