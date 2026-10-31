import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { jiraAuthCheck, jiraDoctorChecks } from "../../../src/issues/jira/doctor.js";
import type { IssueDoctorRepo } from "../../../src/issues/provider.js";
import { checkSummaries } from "../../helpers/doctor.js";
import {
  AUTH_STATUS_ARGS,
  AUTH_STATUS_CALLS,
  JIRA_LOGIN_MESSAGE,
  fakeAcli,
  MEASURED_AUTH_STATUS,
  MEASURED_NOT_FOUND,
} from "../../helpers/fake-acli.js";
import { useTempDir } from "../../helpers/temp.js";

const ACTIVE = "codeguru42.atlassian.net";
const installRemediation = "Install acli, or fix TASKER_ACLI_BIN.";

function repoOf(key: string, site?: string): IssueDoctorRepo {
  return {
    key,
    issueTracker: {
      provider: "jira",
      site,
      updateOnStart: false,
      assignee: "@me",
      updateOnFinish: false,
    },
  };
}

const runAuth = (repos: readonly IssueDoctorRepo[], env: NodeJS.ProcessEnv) => jiraAuthCheck(repos).run(env);

describe("jira doctor", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-jira-doctor-");
  });

  describe("jiraDoctorChecks", () => {
    it("gives no check for no repo", () => {
      expect(jiraDoctorChecks([])).toEqual([]);
    });

    it("gives one acli auth check for all repos", () => {
      const checks = jiraDoctorChecks([repoOf("one", ACTIVE), repoOf("two", ACTIVE)]);

      expect(checkSummaries(checks)).toEqual([{ name: "acli auth", required: true, timeoutMs: 15000 }]);
    });
  });

  describe("jiraAuthCheck", () => {
    it.each([
      [
        "acli is not installed",
        () => "no-such-acli",
        "no-such-acli is not installed: install acli, or fix TASKER_ACLI_BIN",
      ],
      [
        "TASKER_ACLI_BIN is a bad path",
        (d: string) => join(d, "missing"),
        (d: string) =>
          `TASKER_ACLI_BIN is ${join(d, "missing")}, but ${join(d, "missing")} is not a file that you can run`,
      ],
    ])("gives an install remediation when %s", async (_name, binOf, detailOf) => {
      const fake = fakeAcli(dir, {}, []);
      const detail = typeof detailOf === "string" ? detailOf : detailOf(dir);

      expect(await runAuth([repoOf("work")], { ...fake.env, TASKER_ACLI_BIN: binOf(dir) })).toStrictEqual({
        status: "error",
        detail,
        remediation: installRemediation,
      });
      expect(fake.calls()).toEqual([]);
    });

    it("gives a login remediation when acli has no login", async () => {
      const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stderr: MEASURED_NOT_FOUND, exitCode: 1 }]);

      expect(await runAuth([repoOf("work")], fake.env)).toStrictEqual({
        status: "error",
        detail: JIRA_LOGIN_MESSAGE,
        remediation: "Run acli jira auth login.",
      });
      expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
    });

    it("gives a switch remediation when a repo names another site", async () => {
      const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS }]);

      expect(await runAuth([repoOf("work", "other.atlassian.net")], fake.env)).toStrictEqual({
        status: "error",
        detail: `repo work names the site other.atlassian.net, but acli uses ${ACTIVE}`,
        remediation: "Run acli jira auth switch --site other.atlassian.net.",
      });
      expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
    });

    it("lists the wrong repos in the order of the list and names the first site", async () => {
      const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS }]);
      const repos = [
        repoOf("none"),
        repoOf("b", "one.atlassian.net"),
        repoOf("good", ACTIVE),
        repoOf("a", "two.atlassian.net"),
      ];

      expect(await runAuth(repos, fake.env)).toStrictEqual({
        status: "error",
        detail: [
          `repo b names the site one.atlassian.net, but acli uses ${ACTIVE}`,
          `repo a names the site two.atlassian.net, but acli uses ${ACTIVE}`,
        ].join("\n"),
        remediation: "Run acli jira auth switch --site one.atlassian.net.",
      });
      expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
    });

    it("gives two lines and one remediation for two repos with the same wrong site", async () => {
      const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS }]);
      const repos = [repoOf("a", "other.atlassian.net"), repoOf("b", "other.atlassian.net")];

      expect(await runAuth(repos, fake.env)).toStrictEqual({
        status: "error",
        detail: [
          `repo a names the site other.atlassian.net, but acli uses ${ACTIVE}`,
          `repo b names the site other.atlassian.net, but acli uses ${ACTIVE}`,
        ].join("\n"),
        remediation: "Run acli jira auth switch --site other.atlassian.net.",
      });
      expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
    });

    it("is ok for repos with no site, the active site or the active site in other form", async () => {
      const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS }]);
      const repos = [repoOf("none"), repoOf("same", ACTIVE), repoOf("folded", "  CodeGuru42.Atlassian.NET ")];

      expect(await runAuth(repos, fake.env)).toStrictEqual({ status: "ok", detail: `acli uses the site ${ACTIVE}` });
      expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
    });

    it.each([
      ["a wrong site", [repoOf("work", "other.atlassian.net")], MEASURED_AUTH_STATUS, undefined, 0],
      ["the active site", [repoOf("work", ACTIVE)], MEASURED_AUTH_STATUS, undefined, 0],
      ["no login", [repoOf("work")], "", `${MEASURED_NOT_FOUND} user@example.com`, 1],
    ])("shows no email and no login type for %s", async (_name, repos, stdout, stderr, exitCode) => {
      const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stdout, stderr, exitCode }]);

      const text = JSON.stringify(await runAuth(repos, fake.env));

      expect(text).not.toContain("user@example.com");
      expect(text).not.toContain("Authentication Type");
      expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
    });

    it("gives the timeout result and stops acli when acli hangs", async () => {
      const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS, delaySeconds: 5 }]);
      const start = Date.now();

      const result = await jiraAuthCheck([repoOf("work")], 200).run(fake.env);

      expect(result).toStrictEqual({ status: "error", detail: "the check did not finish in 200 ms" });
      expect(Date.now() - start).toBeLessThan(2000);
      expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
    });
  });
});
