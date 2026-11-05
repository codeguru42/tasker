import { describe, expect, it } from "vitest";
import { runFakeGh } from "./fake-gh.js";
import { forgeGh } from "./forge-gh.js";
import { useTempDir } from "./temp.js";

describe("the forge gh helper", () => {
  it("records environment values and whether the token matches without saving the token", () => {
    const dir = useTempDir("tasker-forge-gh-helper-");
    const token = "synthetic-token-value";
    const fake = forgeGh(dir, token, [{ args: ["repo", "view"], stdout: "ok" }], ["TASKER_HOME", "NO_COLOR"]);
    const env = { ...fake.env, TASKER_HOME: "/home/tester", NO_COLOR: "1", GH_TOKEN: token };

    expect(runFakeGh(env, ["repo", "view"])).toMatchObject({ status: 0, stdout: "ok" });
    expect(fake.calls()).toEqual([
      {
        args: ["repo", "view"],
        tokenMatches: true,
        cwd: process.cwd(),
        env: { TASKER_HOME: "/home/tester", NO_COLOR: "1" },
      },
    ]);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
  });

  it("uses the current remote head on each call and logs no token text", () => {
    const dir = useTempDir("tasker-forge-gh-head-");
    const token = "head-token-secret";
    const fake = forgeGh(dir, token, []);
    const env = { ...fake.env, GH_TOKEN: token };
    const setRemoteHead = (head: string) =>
      (fake as typeof fake & { setRemoteHead(head: string): void }).setRemoteHead(head);
    const callHead = (head: string) => {
      setRemoteHead(head);
      return runFakeGh(env, ["pr", "view", "42", "--json", "headRefOid"]);
    };

    expect(callHead("head-one")).toMatchObject({ status: 0, stdout: "head-one" });
    expect(callHead("head-two")).toMatchObject({ status: 0, stdout: "head-two" });
    expect(fake.calls().map(({ args }) => args)).toEqual([
      ["pr", "view", "42", "--json", "headRefOid"],
      ["pr", "view", "42", "--json", "headRefOid"],
    ]);
    expect(fake.calls().every(({ tokenMatches }) => tokenMatches)).toBe(true);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
  });

  it("uses the current merge state on each call and logs no token text", () => {
    const dir = useTempDir("tasker-forge-gh-merge-state-");
    const token = "merge-token-secret";
    const fake = forgeGh(dir, token, []);
    const env = { ...fake.env, GH_TOKEN: token };
    const setMergeState = (state: string) =>
      (fake as typeof fake & { setMergeState(state: string): void }).setMergeState(state);
    const readState = (state: string) => {
      setMergeState(state);
      return runFakeGh(env, ["pr", "view", "42", "--json", "state"]);
    };

    expect(readState("OPEN")).toMatchObject({ status: 0, stdout: "OPEN" });
    expect(readState("MERGED")).toMatchObject({ status: 0, stdout: "MERGED" });
    expect(fake.calls().map(({ args }) => args)).toEqual([
      ["pr", "view", "42", "--json", "state"],
      ["pr", "view", "42", "--json", "state"],
    ]);
    expect(fake.calls().every(({ tokenMatches }) => tokenMatches)).toBe(true);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
  });
});
