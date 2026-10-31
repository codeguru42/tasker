import { beforeEach, describe, expect, it } from "vitest";
import { KEY_PARSERS } from "../../../src/issue-key/resolve.js";
import { authStatus } from "../../../src/issues/jira/auth.js";
import { jiraDoctorChecks } from "../../../src/issues/jira/doctor.js";
import { createJiraProvider } from "../../../src/issues/jira/provider.js";
import { JiraSiteError } from "../../../src/issues/jira/site.js";
import { jiraInProgressMarker } from "../../../src/issues/jira/write.js";
import type { Issue } from "../../../src/issues/issue.js";
import type { IssueProvider } from "../../../src/issues/provider.js";
import { failureOf } from "../../helpers/errors.js";
import {
  acliWriteResult,
  assignArgs,
  AUTH_STATUS_ARGS,
  AUTH_STATUS_CALLS,
  BACKLOG_ISSUE_VIEW,
  fakeAcli,
  type FakeAcli,
  issueViewArgs,
  jiraRefOf,
  linksViewArgs,
  MEASURED_AUTH_STATUS,
  NO_LINKS_VIEW,
  transitionArgs,
} from "../../helpers/fake-acli.js";
import { useTempDir } from "../../helpers/temp.js";

// No default for site: a default parameter takes undefined as a missing argument.
const providerFor = (site: string | undefined) => createJiraProvider({ site });

const ACTIVE_SITE = "codeguru42.atlassian.net";
const ref = jiraRefOf("TEST-1");

interface Member {
  name: string;
  run: (provider: IssueProvider, env: NodeJS.ProcessEnv) => Promise<unknown>;
  args: string[];
}

const MEMBERS: Member[] = [
  { name: "fetchIssue", run: (p, env) => p.fetchIssue(ref, env), args: issueViewArgs("TEST-1") },
  { name: "blockingIssues", run: (p, env) => p.blockingIssues(ref, env), args: linksViewArgs("TEST-1") },
  { name: "assign", run: (p, env) => p.assign(ref, "@me", env), args: assignArgs("TEST-1", "@me") },
  {
    name: "transitionStatus",
    run: (p, env) => p.transitionStatus(ref, "In Progress", env),
    args: transitionArgs("TEST-1", "In Progress"),
  },
  { name: "markDone", run: (p, env) => p.markDone(ref, "Done", env), args: transitionArgs("TEST-1", "Done") },
];

describe("createJiraProvider", () => {
  let dir: string;
  let acli: FakeAcli;

  beforeEach(() => {
    dir = useTempDir("tasker-jira-provider-");
    acli = fakeAcli(dir, {}, [
      { args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS },
      { args: issueViewArgs("TEST-1"), stdout: BACKLOG_ISSUE_VIEW },
      { args: linksViewArgs("TEST-1"), stdout: NO_LINKS_VIEW },
      { args: assignArgs("TEST-1", "@me"), stdout: acliWriteResult("SUCCESS", "assigned") },
      { args: transitionArgs("TEST-1", "In Progress"), stdout: acliWriteResult("SUCCESS", "moved") },
      { args: transitionArgs("TEST-1", "Done"), stdout: acliWriteResult("SUCCESS", "moved") },
    ]);
  });

  it("has the id jira and no account", () => {
    const provider = providerFor(ACTIVE_SITE);
    expect(provider.id).toBe("jira");
    expect(provider.account).toBeUndefined();
  });

  it("uses the functions themselves for the members that need no site", () => {
    const provider = providerFor(ACTIVE_SITE);
    expect(provider.parse).toBe(KEY_PARSERS.jira);
    expect(Reflect.get(provider, "authStatus")).toBe(authStatus);
    expect(provider.inProgressMarker).toBe(jiraInProgressMarker);
    expect(Reflect.get(provider, "doctorChecks")).toBe(jiraDoctorChecks);
  });

  it("gives no base branch hint", () => {
    const issue: Issue = {
      ref,
      title: "Issue 1",
      body: "",
      url: "https://codeguru42.atlassian.net/browse/TEST-1",
      labels: ["base:main"],
      components: [],
      state: "open",
      comments: [],
    };
    expect(providerFor(ACTIVE_SITE).baseBranchHint(issue)).toBeUndefined();
  });

  it("rejects clearInProgress and makes no acli call", async () => {
    const error = await failureOf(providerFor(ACTIVE_SITE).clearInProgress(ref, "In Progress", acli.env), Error);
    expect(error.message).toBe("the jira tracker has no in-progress clear");
    expect(acli.calls()).toEqual([]);
  });

  it.each(MEMBERS)("$name passes its site to the site guard", async ({ run }) => {
    await failureOf(run(providerFor("other.atlassian.net"), acli.env), JiraSiteError);
    expect(acli.calls()).toEqual(AUTH_STATUS_CALLS);
  });

  describe.each([ACTIVE_SITE, undefined])("with the site %s", (site) => {
    it.each(MEMBERS)("$name reaches its acli call", async ({ run, args }) => {
      await run(providerFor(site), acli.env);
      expect(acli.calls().map((call) => call.args)).toEqual([AUTH_STATUS_ARGS, args]);
    });
  });
});
