import { beforeEach, describe, expect, it } from "vitest";
import { type Issue, IssueWriteError } from "../../../src/issues/issue.js";
import { AcliNotInstalledError } from "../../../src/issues/jira/run.js";
import { JiraLoginError, JiraSiteError } from "../../../src/issues/jira/site.js";
import {
  assignJiraIssue,
  jiraInProgressMarker,
  markJiraDone,
  markJiraInProgress,
} from "../../../src/issues/jira/write.js";
import { failureOf } from "../../helpers/errors.js";
import {
  acliWriteResult,
  assignArgs,
  AUTH_STATUS_ARGS,
  fakeAcli,
  type FakeAcliAnswer,
  jiraRefOf,
  MEASURED_AUTH_STATUS,
  transitionArgs,
} from "../../helpers/fake-acli.js";
import { useTempDir } from "../../helpers/temp.js";

const ASSIGNED = "Work item TEST-10 has been successfully assigned to user@example.com";

const BAD_OUTPUTS = [
  "",
  "not json",
  "5",
  "null",
  "[]",
  "{}",
  '{"results":5}',
  '{"results":{}}',
  '{"results":[]}',
  JSON.stringify({
    results: [
      { status: "SUCCESS", message: "a", id: "TEST-10" },
      { status: "SUCCESS", message: "b", id: "TEST-10" },
    ],
  }),
  '{"results":[5]}',
  '{"results":[null]}',
  '{"results":[[]]}',
  '{"results":[{}]}',
  '{"results":[{"status":5}]}',
];

describe("Jira writes", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-jira-write-");
  });

  function fakeWrite(args: readonly string[], answer: Omit<FakeAcliAnswer, "args">) {
    return fakeAcli(dir, {}, [
      { args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS },
      { args, ...answer },
    ]);
  }

  const callArgs = (fake: ReturnType<typeof fakeWrite>) => fake.calls().map((call) => call.args);

  const assign = (env: NodeJS.ProcessEnv, assignee = "@me", site?: string) =>
    assignJiraIssue(jiraRefOf("TEST-10"), assignee, site, env);

  const MOVED = "Work item TEST-10 has been successfully transitioned to In Progress";

  const WRITES = [
    {
      name: "assignJiraIssue",
      args: assignArgs("TEST-10", "@me"),
      configKey: "issueTracker.assignee",
      prefix: 'could not assign TEST-10 to "@me"',
      passed: ASSIGNED,
      write: (env: NodeJS.ProcessEnv, site?: string) => assign(env, "@me", site),
    },
    {
      name: "markJiraInProgress",
      args: transitionArgs("TEST-10", "In Progress"),
      configKey: "issueTracker.inProgressStatus",
      prefix: 'could not move TEST-10 to the status "In Progress" of issueTracker.inProgressStatus',
      passed: MOVED,
      write: (env: NodeJS.ProcessEnv, site?: string) =>
        markJiraInProgress(jiraRefOf("TEST-10"), "In Progress", site, env),
    },
    {
      name: "markJiraDone",
      args: transitionArgs("TEST-10", "Awaiting deploy"),
      configKey: "issueTracker.doneStatus",
      prefix: 'could not move TEST-10 to the status "Awaiting deploy" of issueTracker.doneStatus',
      passed: MOVED,
      write: (env: NodeJS.ProcessEnv, site?: string) =>
        markJiraDone(jiraRefOf("TEST-10"), "Awaiting deploy", site, env),
    },
  ];

  describe.each(WRITES)("$name", ({ args, configKey, prefix, passed, write }) => {
    it("rejects with JiraSiteError for another site and makes no write", async () => {
      const fake = fakeWrite(args, { stdout: acliWriteResult("SUCCESS", passed) });

      await failureOf(write(fake.env, "other.atlassian.net"), JiraSiteError);

      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS]);
    });

    it("runs the write with its arguments", async () => {
      const fake = fakeWrite(args, { stdout: acliWriteResult("SUCCESS", passed) });

      await write(fake.env);

      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS, args]);
    });

    it("gives IssueWriteError for an acli failure with the message of the AcliError", async () => {
      const fake = fakeWrite(args, { stderr: "boom", exitCode: 1 });

      const error = await failureOf(write(fake.env), IssueWriteError);

      expect(error.key).toBe("TEST-10");
      expect(error.configKey).toBe(configKey);
      expect(error.message).toBe(`${prefix}: acli jira workitem failed with exit code 1: boom`);
      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS, args]);
    });

    it.each(["No allowed transitions found for given status", "unexpected error, trace id: abc"])(
      "gives the message of a FAILURE result with exit code 0: %s",
      async (message) => {
        const fake = fakeWrite(args, { stdout: acliWriteResult("FAILURE", message) });

        const error = await failureOf(write(fake.env), IssueWriteError);

        expect(error.configKey).toBe(configKey);
        expect(error.message).toBe(`${prefix}: ${message}`);
      },
    );

    it.each(['{"results":[{"status":"FAILURE","id":"TEST-10"}]}', '{"results":[{"status":"FAILURE","message":5}]}'])(
      "says that acli gave no message: %s",
      async (stdout) => {
        const fake = fakeWrite(args, { stdout });

        const error = await failureOf(write(fake.env), IssueWriteError);

        expect(error.message).toBe(`${prefix}: acli gave no message`);
      },
    );

    it("gives an empty text for an empty message", async () => {
      const fake = fakeWrite(args, { stdout: acliWriteResult("FAILURE", "") });

      const error = await failureOf(write(fake.env), IssueWriteError);

      expect(error.message).toBe(`${prefix}: `);
    });

    it.each(["success", ""])("does not take the status %j as SUCCESS", async (resultStatus) => {
      const fake = fakeWrite(args, { stdout: acliWriteResult(resultStatus, "nope") });

      const error = await failureOf(write(fake.env), IssueWriteError);

      expect(error.message).toBe(`${prefix}: nope`);
    });

    it.each(BAD_OUTPUTS)("says that acli gave bad output: %j", async (stdout) => {
      const fake = fakeWrite(args, { stdout });

      const error = await failureOf(write(fake.env), IssueWriteError);

      expect(error.message).toBe(`${prefix}: acli gave bad output`);
      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS, args]);
    });

    it("passes through JiraLoginError", async () => {
      const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, exitCode: 1, stderr: "not logged in" }]);

      await failureOf(write(fake.env), JiraLoginError);
    });

    it("passes through AcliNotInstalledError", async () => {
      const empty = useTempDir("tasker-jira-write-empty-");

      await failureOf(write({ PATH: empty }), AcliNotInstalledError);
    });
  });

  describe("assignJiraIssue", () => {
    it("passes @me as it is", async () => {
      const fake = fakeWrite(assignArgs("TEST-10", "@me"), { stdout: acliWriteResult("SUCCESS", ASSIGNED) });

      await assign(fake.env);

      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS, assignArgs("TEST-10", "@me")]);
    });

    it("passes a named assignee as one argument", async () => {
      const fake = fakeWrite(assignArgs("TEST-10", "Ann Lee"), { stdout: acliWriteResult("SUCCESS", ASSIGNED) });

      await assign(fake.env, "Ann Lee");

      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS, assignArgs("TEST-10", "Ann Lee")]);
    });

    it("shows the assignee in JSON form in the message", async () => {
      const fake = fakeWrite(assignArgs("TEST-10", 'a"b'), { stderr: "boom", exitCode: 1 });

      const error = await failureOf(assign(fake.env, 'a"b'), IssueWriteError);

      expect(error.message).toContain('assign TEST-10 to "a\\"b": ');
    });
  });

  describe("markJiraDone with no status", () => {
    it("rejects with a plain Error and runs only the site guard", async () => {
      const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS }]);

      const error = await failureOf(markJiraDone(jiraRefOf("TEST-10"), undefined, undefined, fake.env), Error);

      expect(error.message).toBe("issueTracker.doneStatus is not set");
      expect(error).not.toBeInstanceOf(IssueWriteError);
      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS]);
    });
  });

  describe("jiraInProgressMarker", () => {
    const issueWith = (status?: string): Issue => ({
      ref: jiraRefOf("TEST-10"),
      title: "t",
      body: "",
      url: "https://example.atlassian.net/browse/TEST-10",
      labels: [],
      components: [],
      ...(status === undefined ? {} : { status }),
      state: "open",
      comments: [],
    });

    it.each(["In Progress", "IN PROGRESS", "in progress"])("is true for the status %j", (status) => {
      expect(jiraInProgressMarker(issueWith(status), "In Progress")).toBe(true);
    });

    it("is false for another status", () => {
      expect(jiraInProgressMarker(issueWith("Backlog"), "In Progress")).toBe(false);
    });

    it("is false when the configured status is undefined", () => {
      expect(jiraInProgressMarker(issueWith("In Progress"), undefined)).toBe(false);
    });

    it("is false for an issue with no status", () => {
      expect(jiraInProgressMarker(issueWith(), "In Progress")).toBe(false);
    });

    it("does not fold the Kelvin sign to k", () => {
      expect(jiraInProgressMarker(issueWith("\u212Aanban"), "kanban")).toBe(false);
    });
  });
});
