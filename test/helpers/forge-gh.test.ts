import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { thrownBy } from "./errors.js";
import { runFakeGh } from "./fake-gh.js";
import {
  forgeGh,
  installMergeForgeGh,
  openPrListArgs,
  openPrTokenAnswer,
  OPEN_PR_FORGE_ACCOUNT,
  OPEN_PR_FORGE_TOKEN,
} from "./forge-gh.js";
import { useTempDir } from "./temp.js";

describe("the forge gh helper", () => {
  it("returns configured merge states in order and repeats the last state", () => {
    const fake = forgeGh(useTempDir("tasker-forge-states-"), "test-token", []);
    fake.setMergeStates(["OPEN", "MERGED"]);
    const args = ["pr", "view", "42", "--json", "state"];
    for (const state of ["OPEN", "MERGED", "MERGED"]) {
      expect(runFakeGh(fake.env, args)).toMatchObject({ status: 0, stdout: JSON.stringify({ state }) });
    }
    fake.setMergeState("CLOSED");
    expect(runFakeGh(fake.env, args)).toMatchObject({ status: 0, stdout: JSON.stringify({ state: "CLOSED" }) });
    expect(thrownBy(() => fake.setMergeStates([]))).toMatchObject({ message: "merge states must not be empty" });
  });
  it("installs a merge fixture with shared token and environment setup", () => {
    const token = openPrTokenAnswer();
    const fake = installMergeForgeGh([token], "tasker-merge-forge-gh-helper-");

    expect(fake.env.TASKER_GH_BIN).toBeTruthy();
    expect(process.env.TASKER_GH_BIN).toBe(fake.env.TASKER_GH_BIN);
    expect(process.env.TASKER_GH_CONFIG_DIR).toBe("/tasker/open-pr-forge-gh-config");
    expect(process.env.TASKER_HOME).toBe("/tasker/open-pr-forge-home");
    expect(openPrTokenAnswer()).toEqual(token);
  });

  it("shares the open-pr account, token answer, list arguments, and installer", () => {
    const token = openPrTokenAnswer();
    const args = openPrListArgs("branch-name");
    const fake = installMergeForgeGh([token, { args, stdout: "[]" }], "tasker-open-pr-gh-helper-");

    expect(OPEN_PR_FORGE_ACCOUNT).toBe("forge-team");
    expect(OPEN_PR_FORGE_TOKEN).toBe("forge-token-private");
    expect(token).toEqual({ args: ["auth", "token", "--user", "forge-team"], stdout: "forge-token-private\n" });
    expect(args).toEqual([
      "pr",
      "list",
      "--head",
      "branch-name",
      "--state",
      "open",
      "--json",
      "number,url,baseRefName,isCrossRepository",
      "--limit",
      "100",
    ]);
    expect(runFakeGh({ ...fake.env, GH_TOKEN: OPEN_PR_FORGE_TOKEN }, args)).toMatchObject({ status: 0, stdout: "[]" });
    fake.assertAnswered();
  });

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

  it("keeps the token out of the executable and preserves token-bearing output", () => {
    const dir = useTempDir("tasker-forge-gh-token-output-");
    const token = "diagnostic-token-secret";
    const args = ["auth", "status"];
    const fake = forgeGh(dir, token, [{ args, stdout: token, stderr: `lookup failed: ${token}` }]);
    const executable = readFileSync(join(dir, "bin", "gh"), "utf8");

    expect(executable).not.toContain(token);
    expect(runFakeGh({ ...fake.env, GH_TOKEN: token }, args)).toMatchObject({
      status: 0,
      stdout: token,
      stderr: `lookup failed: ${token}`,
    });
    expect(JSON.stringify(fake.calls())).not.toContain(token);
  });

  it("prints empty output plainly and decodes token-bearing output", () => {
    const dir = useTempDir("tasker-forge-gh-output-branches-");
    const token = "branch-token-secret";
    const fake = forgeGh(dir, token, [
      { args: ["empty"], stdout: "", stderr: "" },
      { args: ["token"], stdout: token, stderr: `lookup failed: ${token}` },
    ]);
    const executable = readFileSync(join(dir, "bin", "gh"), "utf8");
    const emptyArg = executable.indexOf("empty");
    const emptyBranchStart = executable.lastIndexOf("if ", emptyArg);
    const emptyBranchEnd = executable.indexOf("\nfi", emptyArg);
    const emptyBranch = executable.slice(emptyBranchStart, emptyBranchEnd);
    const tokenArg = executable.indexOf("token", emptyBranchEnd);
    const tokenBranchStart = executable.lastIndexOf("if ", tokenArg);
    const tokenBranchEnd = executable.indexOf("\nfi", tokenArg);
    const tokenBranch = executable.slice(tokenBranchStart, tokenBranchEnd);

    expect(runFakeGh({ ...fake.env, GH_TOKEN: token }, ["empty"])).toMatchObject({ status: 0, stdout: "", stderr: "" });
    expect(emptyBranch).toContain("printf '%s' ''");
    expect(emptyBranch).not.toContain("base64");
    expect(tokenBranch).toContain("base64");
    expect(runFakeGh({ ...fake.env, GH_TOKEN: token }, ["token"])).toMatchObject({
      status: 0,
      stdout: token,
      stderr: `lookup failed: ${token}`,
    });
    expect(executable).not.toContain(token);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
    expect(fake.calls().map(({ args: callArgs }) => callArgs)).toEqual([["empty"], ["token"]]);
  });

  it("uses the current remote head on each call and logs no token text", () => {
    const dir = useTempDir("tasker-forge-gh-head-");
    const token = "head-token-secret";
    const fake = forgeGh(dir, token, []);
    const env = { ...fake.env, GH_TOKEN: token };
    const callHead = (head: string) => {
      fake.setRemoteHead(head);
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
    const readState = (state: string) => {
      fake.setMergeState(state);
      return runFakeGh(env, ["pr", "view", "42", "--json", "state"]);
    };

    expect(readState("OPEN")).toMatchObject({ status: 0, stdout: JSON.stringify({ state: "OPEN" }) });
    expect(readState("MERGED")).toMatchObject({ status: 0, stdout: JSON.stringify({ state: "MERGED" }) });
    expect(fake.calls().map(({ args }) => args)).toEqual([
      ["pr", "view", "42", "--json", "state"],
      ["pr", "view", "42", "--json", "state"],
    ]);
    expect(fake.calls().every(({ tokenMatches }) => tokenMatches)).toBe(true);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
  });

  it("allows a guarded merge only when the current remote head matches", () => {
    const dir = useTempDir("tasker-forge-gh-guarded-merge-");
    const token = "guarded-merge-token-secret";
    const head = "expected-head-sha";
    const args = ["pr", "merge", "42", "--squash", "--match-head-commit", head];
    const fake = forgeGh(dir, token, [{ args, stdout: "Merge accepted." }]);
    const env = { ...fake.env, GH_TOKEN: token };

    fake.setRemoteHead(head);
    expect(runFakeGh(env, args)).toMatchObject({ status: 0, stdout: "Merge accepted." });

    fake.setRemoteHead("changed-head-sha");
    expect(runFakeGh(env, args)).toMatchObject({ status: 1 });
    expect(fake.calls().map(({ args: callArgs }) => callArgs)).toEqual([args, args]);
    expect(fake.calls().every(({ tokenMatches }) => tokenMatches)).toBe(true);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
    fake.assertAnswered();
  });
});
