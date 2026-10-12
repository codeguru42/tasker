import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/schema.js";
import { issueProviderFor } from "../../src/issues/provider.js";
import { configWithTrackers } from "../helpers.js";

const github = (account: string) => ({ provider: "github", account });

describe("issueProviderFor", () => {
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

  it("gives doctor checks for the repos of the pair only", () => {
    const config = configWithTrackers({ "a/b": github("x"), "c/d": github("y"), "e/f": github("x") });
    expect(issueProviderFor(config, "a/b").doctorChecks.map((check) => check.name)).toEqual([
      "gh version",
      "gh auth: x",
      "gh project: a/b",
      "gh labels: a/b",
      "gh project: e/f",
      "gh labels: e/f",
    ]);
  });

  it("throws a ConfigError for a jira repo", () => {
    const config = configWithTrackers({ j: { provider: "jira" } });
    expect(() => issueProviderFor(config, "j")).toThrow(ConfigError);
    try {
      issueProviderFor(config, "j");
    } catch (error) {
      expect((error as ConfigError).issues).toEqual([
        "repos.j.issueTracker.provider: the jira tracker is not available in this version",
      ]);
    }
  });

  it.each(["nope", "constructor", "__proto__"])("throws for the unknown repo key %s", (key) => {
    const config = configWithTrackers({ "a/b": github("x") });
    expect(() => issueProviderFor(config, key)).toThrow(
      `unknown repo "${key}": no repo with this key is in the configuration`,
    );
  });
});
