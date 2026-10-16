import { describe, expect, it } from "vitest";
import { reposByProvider } from "../../src/config/repo-groups.js";
import { parseConfig } from "../../src/config/schema.js";
import { configWithTrackers, validConfig } from "../helpers/config.js";

const account = (repo: { issueTracker: { provider: string } }) => (repo.issueTracker as { account?: string }).account;
const github = (name: string) => ({ provider: "github", account: name });

describe("reposByProvider", () => {
  it("groups the repos by id in the order of first use", () => {
    const config = configWithTrackers({ r1: github("a"), r2: github("b"), r3: github("a") });
    expect(reposByProvider(config, account, (key) => key)).toEqual([
      ["a", ["r1", "r3"]],
      ["b", ["r2"]],
    ]);
  });

  it("keeps the order of the configuration inside a group", () => {
    const config = configWithTrackers({ r3: github("a"), r1: github("a"), r2: github("a") });
    expect(reposByProvider(config, account, (key) => key)).toEqual([["a", ["r3", "r1", "r2"]]]);
  });

  it("gives the values of doctorRepo with the key and the repo", () => {
    const config = configWithTrackers({ r1: github("a") });
    expect(reposByProvider(config, account, (key, repo) => ({ key, tracker: repo.issueTracker }))).toEqual([
      ["a", [{ key: "r1", tracker: config.repos.r1.issueTracker }]],
    ]);
  });

  it("gives [] for a configuration with no repo", () => {
    const raw = validConfig();
    raw.repos = {};
    const config = parseConfig(raw, {}, "/home/test");
    expect(reposByProvider(config, account, (key) => key)).toEqual([]);
  });
});
