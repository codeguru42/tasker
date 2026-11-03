import { afterEach, describe, expect, it, vi } from "vitest";
import { issueDoctorChecks, issueProviderFor } from "../../src/issues/provider.js";
import { configWithTrackers } from "../helpers/config.js";
import {
  AUTH_STATUS_ARGS,
  BACKLOG_ISSUE_VIEW,
  fakeAcli,
  issueViewArgs,
  MEASURED_AUTH_STATUS,
} from "../helpers/fake-acli.js";
import { fakeFetch } from "../helpers/fake-fetch.js";
import { useTempDir } from "../helpers/temp.js";

const github = (account: string) => ({ provider: "github", account });
const jira = (site: string | undefined) => ({ provider: "jira", project: "TEST", site });

describe("issueProviderFor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives a github provider with the account of the repo", () => {
    const provider = issueProviderFor(configWithTrackers({ "a/b": github("x") }), "a/b");
    expect(provider.id).toBe("github");
    expect(provider.account).toBe("x");
  });

  it("gives the same object for two repos with the same account", () => {
    const config = configWithTrackers({ "a/b": github("x"), "c/d": github("x") });
    expect(issueProviderFor(config, "a/b")).toBe(issueProviderFor(config, "c/d"));
  });

  it("gives different objects for two repos with different accounts", () => {
    const config = configWithTrackers({ "a/b": github("x"), "c/d": github("y") });
    const first = issueProviderFor(config, "a/b");
    const second = issueProviderFor(config, "c/d");
    expect(first).not.toBe(second);
    expect(first.account).toBe("x");
    expect(second.account).toBe("y");
  });

  it("gives the same object for two calls for one repo", () => {
    const config = configWithTrackers({ "a/b": github("x") });
    expect(issueProviderFor(config, "a/b")).toBe(issueProviderFor(config, "a/b"));
  });

  it("gives a new object for the same repo in another configuration object", () => {
    const trackers = { "a/b": github("x") };
    expect(issueProviderFor(configWithTrackers(trackers), "a/b")).not.toBe(
      issueProviderFor(configWithTrackers(trackers), "a/b"),
    );
  });

  it("gives doctor checks in the order of #40 for all repos", () => {
    const config = configWithTrackers({ "a/b": github("x"), "c/d": github("y"), "e/f": github("x") });
    expect(issueDoctorChecks(config).map((check) => check.name)).toEqual([
      "gh version",
      "gh auth: x",
      "gh auth: y",
      "gh project: a/b",
      "gh labels: a/b",
      "gh project: c/d",
      "gh labels: c/d",
      "gh project: e/f",
      "gh labels: e/f",
    ]);
  });

  it("gives one gh version check for two accounts", () => {
    const config = configWithTrackers({ "a/b": github("x"), "c/d": github("y") });
    expect(issueDoctorChecks(config).filter((check) => check.name === "gh version")).toHaveLength(1);
  });

  it("gives no doctor checks for a configuration with no repo", () => {
    expect(issueDoctorChecks({ ...configWithTrackers({ "a/b": github("x") }), repos: {} })).toEqual([]);
  });

  it("gives a jira provider for a jira repo", () => {
    const config = configWithTrackers({ j: jira("one.atlassian.net") });
    expect(issueProviderFor(config, "j").id).toBe("jira");
  });

  it("gives the settings of each repo to the jira provider", async () => {
    const config = configWithTrackers({
      j: { ...jira("one.atlassian.net"), baseBranchFieldName: "Release Branch", apiToken: "test-token" },
      k: jira("one.atlassian.net"),
    });
    const acli = fakeAcli(useTempDir("tasker-provider-"), {}, [
      { args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS },
      { args: issueViewArgs("TEST-1"), stdout: BACKLOG_ISSUE_VIEW },
    ]);
    const fake = fakeFetch([]);
    vi.stubGlobal("fetch", fake.fetch);
    const provider = issueProviderFor(config, "j");
    const ref = (repoKey: string) => ({ key: "TEST-1", repoKey, shortRef: "TEST-1" });

    // The fake fetch has no route, so the lookup of j fails after one REST call. k makes none.
    await provider.fetchIssue(ref("k"), acli.env).catch(() => undefined);
    expect(fake.calls()).toEqual([]);
    await provider.fetchIssue(ref("j"), acli.env).catch(() => undefined);
    expect(fake.calls()).toHaveLength(1);
  });

  it("gives the same object for two jira repos with the same site", () => {
    const config = configWithTrackers({ j: jira("one.atlassian.net"), k: jira("one.atlassian.net") });
    expect(issueProviderFor(config, "j")).toBe(issueProviderFor(config, "k"));
  });

  it("gives the same object for two jira repos with no site", () => {
    const config = configWithTrackers({ j: jira(undefined), k: jira(undefined) });
    expect(issueProviderFor(config, "j")).toBe(issueProviderFor(config, "k"));
  });

  it("gives different objects for two jira repos with different sites", () => {
    const config = configWithTrackers({ j: jira("one.atlassian.net"), k: jira("two.atlassian.net") });
    expect(issueProviderFor(config, "j")).not.toBe(issueProviderFor(config, "k"));
  });

  it("gives different objects for a jira repo with a site and one with no site", () => {
    const config = configWithTrackers({ j: jira("one.atlassian.net"), k: jira(undefined) });
    expect(issueProviderFor(config, "j")).not.toBe(issueProviderFor(config, "k"));
  });

  it("gives one acli auth check for two jira repos with different sites", () => {
    const config = configWithTrackers({ j: jira("one.atlassian.net"), k: jira("two.atlassian.net") });
    expect(issueDoctorChecks(config).map((check) => check.name)).toEqual(["acli auth"]);
  });

  it.each(["nope", "constructor", "__proto__"])("throws for the unknown repo key %s", (key) => {
    const config = configWithTrackers({ "a/b": github("x") });
    expect(() => issueProviderFor(config, key)).toThrow(
      `unknown repo "${key}": no repo with this key is in the configuration`,
    );
  });
});
