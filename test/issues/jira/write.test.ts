import { beforeEach, describe, expect, it } from "vitest";
import { IssueWriteError } from "../../../src/issues/issue.js";
import { AcliNotInstalledError } from "../../../src/issues/jira/run.js";
import { JiraLoginError, JiraSiteError } from "../../../src/issues/jira/site.js";
import { assignJiraIssue } from "../../../src/issues/jira/write.js";
import { failureOf } from "../../helpers/errors.js";
import {
  acliWriteResult,
  AUTH_STATUS_ARGS,
  type FakeAcliAnswer,
  fakeAcli,
  jiraRefOf,
  MEASURED_AUTH_STATUS,
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

  const assignArgs = (assignee: string) => [
    "jira",
    "workitem",
    "assign",
    "--key",
    "TEST-10",
    "--assignee",
    assignee,
    "--yes",
    "--json",
  ];

  function fakeFor(assignee: string, answer: Omit<FakeAcliAnswer, "args">) {
    return fakeAcli(dir, {}, [
      { args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS },
      { args: assignArgs(assignee), ...answer },
    ]);
  }

  const assign = (env: NodeJS.ProcessEnv, assignee = "@me", site?: string) =>
    assignJiraIssue(jiraRefOf("TEST-10"), assignee, site, env);

  const callArgs = (fake: ReturnType<typeof fakeFor>) => fake.calls().map((call) => call.args);

  describe("assignJiraIssue", () => {
    it("rejects with JiraSiteError for another site and makes no write", async () => {
      const fake = fakeFor("@me", { stdout: acliWriteResult("SUCCESS", ASSIGNED) });

      await failureOf(assign(fake.env, "@me", "other.atlassian.net"), JiraSiteError);

      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS]);
    });

    it("passes @me as it is", async () => {
      const fake = fakeFor("@me", { stdout: acliWriteResult("SUCCESS", ASSIGNED) });

      await assign(fake.env);

      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS, assignArgs("@me")]);
    });

    it("passes a named assignee as one argument", async () => {
      const fake = fakeFor("Ann Lee", { stdout: acliWriteResult("SUCCESS", ASSIGNED) });

      await assign(fake.env, "Ann Lee");

      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS, assignArgs("Ann Lee")]);
    });

    it("gives IssueWriteError for an acli failure with the message of the AcliError", async () => {
      const fake = fakeFor("@me", { stderr: "boom", exitCode: 1 });

      const error = await failureOf(assign(fake.env), IssueWriteError);

      expect(error.key).toBe("TEST-10");
      expect(error.configKey).toBe("issueTracker.assignee");
      expect(error.message).toBe('could not assign TEST-10 to "@me": acli jira workitem failed with exit code 1: boom');
      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS, assignArgs("@me")]);
    });

    it("shows the assignee in JSON form in the message", async () => {
      const fake = fakeFor('a"b', { stderr: "boom", exitCode: 1 });

      const error = await failureOf(assign(fake.env, 'a"b'), IssueWriteError);

      expect(error.message).toContain('assign TEST-10 to "a\\"b": ');
    });

    it.each(["No allowed transitions found for given status", "unexpected error, trace id: abc"])(
      "gives the message of a FAILURE result with exit code 0: %s",
      async (message) => {
        const fake = fakeFor("@me", { stdout: acliWriteResult("FAILURE", message) });

        const error = await failureOf(assign(fake.env), IssueWriteError);

        expect(error.configKey).toBe("issueTracker.assignee");
        expect(error.message).toBe(`could not assign TEST-10 to "@me": ${message}`);
      },
    );

    it.each(['{"results":[{"status":"FAILURE","id":"TEST-10"}]}', '{"results":[{"status":"FAILURE","message":5}]}'])(
      "says that acli gave no message: %s",
      async (stdout) => {
        const fake = fakeFor("@me", { stdout });

        const error = await failureOf(assign(fake.env), IssueWriteError);

        expect(error.message).toBe('could not assign TEST-10 to "@me": acli gave no message');
      },
    );

    it("gives an empty text for an empty message", async () => {
      const fake = fakeFor("@me", { stdout: acliWriteResult("FAILURE", "") });

      const error = await failureOf(assign(fake.env), IssueWriteError);

      expect(error.message).toBe('could not assign TEST-10 to "@me": ');
    });

    it.each(["success", ""])("does not take the status %j as SUCCESS", async (status) => {
      const fake = fakeFor("@me", { stdout: acliWriteResult(status, "nope") });

      const error = await failureOf(assign(fake.env), IssueWriteError);

      expect(error.message).toBe('could not assign TEST-10 to "@me": nope');
    });

    it.each(BAD_OUTPUTS)("says that acli gave bad output: %j", async (stdout) => {
      const fake = fakeFor("@me", { stdout });

      const error = await failureOf(assign(fake.env), IssueWriteError);

      expect(error.message).toBe('could not assign TEST-10 to "@me": acli gave bad output');
      expect(callArgs(fake)).toEqual([AUTH_STATUS_ARGS, assignArgs("@me")]);
    });

    it("passes through JiraLoginError", async () => {
      const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, exitCode: 1, stderr: "not logged in" }]);

      await failureOf(assign(fake.env), JiraLoginError);
    });

    it("passes through AcliNotInstalledError", async () => {
      const empty = useTempDir("tasker-jira-write-empty-");

      await failureOf(assign({ PATH: empty }), AcliNotInstalledError);
    });
  });
});
