import { beforeEach, describe, expect, it } from "vitest";
import { KEY_PARSERS } from "../../../src/issue-key/resolve.js";
import { authStatus } from "../../../src/issues/jira/auth.js";
import { jiraDoctorChecks } from "../../../src/issues/jira/doctor.js";
import { jiraBaseBranchHint } from "../../../src/issues/jira/hint.js";
import { createJiraProvider, type JiraRepoSettings } from "../../../src/issues/jira/provider.js";
import { JiraCredentialError, JiraRestError } from "../../../src/issues/jira/rest.js";
import { JiraSiteError } from "../../../src/issues/jira/site.js";
import { jiraInProgressMarker } from "../../../src/issues/jira/write.js";
import type { IssueProvider } from "../../../src/issues/provider.js";
import { failureOf } from "../../helpers/errors.js";
import { fakeFetch } from "../../helpers/fake-fetch.js";
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
import { FAKE_BASIC_AUTH, withFakeToken } from "../../helpers/fake-credentials.js";

// No default for site: a default parameter takes undefined as a missing argument.
const providerFor = (site: string | undefined) => createJiraProvider({ site, settingsOf: () => ({}) });

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
  {
    name: "markAborted",
    run: (p, env) => p.markAborted(ref, "Cancelled", env),
    args: transitionArgs("TEST-1", "Cancelled"),
  },
  {
    name: "markReview",
    run: (p, env) => p.markReview(ref, "In Review", env),
    args: transitionArgs("TEST-1", "In Review"),
  },
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
      { args: transitionArgs("TEST-1", "Cancelled"), stdout: acliWriteResult("SUCCESS", "moved") },
      { args: transitionArgs("TEST-1", "In Review"), stdout: acliWriteResult("SUCCESS", "moved") },
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

  it("uses jiraBaseBranchHint for the base branch hint", () => {
    expect(providerFor(ACTIVE_SITE).baseBranchHint).toBe(jiraBaseBranchHint);
  });

  it("rejects clearInProgress and makes no acli call", async () => {
    const error = await failureOf(providerFor(ACTIVE_SITE).clearInProgress(ref, "In Progress", acli.env), Error);
    expect(error.message).toBe("the jira tracker has no in-progress clear");
    expect(acli.calls()).toEqual([]);
  });

  it("rejects moveCard and makes no acli call", async () => {
    const error = await failureOf(
      providerFor(ACTIVE_SITE).moveCard(
        ref,
        { owner: "octo", number: 3, field: "Status" },
        "Done",
        "issueTracker.board.done",
        acli.env,
      ),
      Error,
    );
    expect(error.message).toBe("the jira tracker has no board move");
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

  describe("the lookup of the base branch field", () => {
    const FIELD = "customfield_10001";
    const OTHER_FIELD = "customfield_10002";
    const ISSUE_URL = "https://codeguru42.atlassian.net/rest/api/3/issue/TEST-1?expand=names";
    const NAMES = { summary: "Summary", [FIELD]: "Release Branch", [OTHER_FIELD]: "Other Branch" };
    const otherRef = { ...ref, repoKey: "other" };

    beforeEach(() => {
      acli = fakeAcli(dir, {}, [
        { args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS },
        { args: issueViewArgs("TEST-1", FIELD), stdout: BACKLOG_ISSUE_VIEW },
        { args: issueViewArgs("TEST-1", OTHER_FIELD), stdout: BACKLOG_ISSUE_VIEW },
        { args: issueViewArgs("TEST-1"), stdout: BACKLOG_ISSUE_VIEW },
      ]);
    });

    function providerWith(
      settings: Record<string, JiraRepoSettings>,
      routes: { url: string; status: number; body?: unknown }[],
    ) {
      const fake = fakeFetch(routes);
      const provider = createJiraProvider({
        site: ACTIVE_SITE,
        settingsOf: (key) => settings[key] ?? {},
        fetch: fake.fetch,
      });
      return { fake, provider };
    }

    it("looks up the id with basic auth, then reads the issue with the id", async () => {
      const { fake, provider } = providerWith({ work: { baseBranchFieldName: "Release Branch" } }, [
        { url: ISSUE_URL, status: 200, body: { names: NAMES } },
      ]);

      await provider.fetchIssue(ref, withFakeToken(acli.env));

      expect(fake.calls().map((call) => [call.url, call.authorization])).toEqual([[ISSUE_URL, FAKE_BASIC_AUTH]]);
      expect(acli.calls().map((call) => call.args)).toEqual([AUTH_STATUS_ARGS, issueViewArgs("TEST-1", FIELD)]);
    });

    it("makes no second REST call for a second read of the same repo", async () => {
      const { fake, provider } = providerWith({ work: { baseBranchFieldName: "Release Branch" } }, [
        { url: ISSUE_URL, status: 200, body: { names: NAMES } },
      ]);

      await provider.fetchIssue(ref, withFakeToken(acli.env));
      await provider.fetchIssue(ref, withFakeToken(acli.env));

      expect(fake.calls()).toHaveLength(1);
    });

    it("gives each repo of one site its own lookup", async () => {
      const { fake, provider } = providerWith(
        {
          work: { baseBranchFieldName: "Release Branch" },
          other: { baseBranchFieldName: "Other Branch" },
        },
        [{ url: ISSUE_URL, status: 200, body: { names: NAMES } }],
      );

      const first = await provider.fetchIssue(ref, withFakeToken(acli.env));
      const second = await provider.fetchIssue(otherRef, withFakeToken(acli.env));

      expect(fake.calls()).toHaveLength(2);
      expect(first.baseBranchField?.id).toBe(FIELD);
      expect(second.baseBranchField?.id).toBe(OTHER_FIELD);
    });

    it("keeps a failed lookup: one REST call and the same error for two reads", async () => {
      const { fake, provider } = providerWith({ work: { baseBranchFieldName: "Release Branch" } }, [
        { url: ISSUE_URL, status: 404, body: {} },
      ]);

      const first = await failureOf(provider.fetchIssue(ref, withFakeToken(acli.env)), JiraRestError);
      const second = await failureOf(provider.fetchIssue(ref, withFakeToken(acli.env)), JiraRestError);

      expect(second).toBe(first);
      expect(fake.calls()).toHaveLength(1);
    });

    it("keeps a missing token: the same error, no REST call and no view call", async () => {
      const { fake, provider } = providerWith({ work: { baseBranchFieldName: "Release Branch" } }, []);

      const first = await failureOf(provider.fetchIssue(ref, acli.env), JiraCredentialError);
      const second = await failureOf(provider.fetchIssue(ref, acli.env), JiraCredentialError);

      expect(second).toBe(first);
      expect(fake.calls()).toEqual([]);
      expect(acli.calls().every((call) => call.args[1] === "auth")).toBe(true);
    });

    it("makes no REST call for a repo with no baseBranchFieldName", async () => {
      const { fake, provider } = providerWith({}, []);

      const issue = await provider.fetchIssue(ref, withFakeToken(acli.env));

      expect(fake.calls()).toEqual([]);
      expect(issue).not.toHaveProperty("baseBranchField");
    });
  });
});
