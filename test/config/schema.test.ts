import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../../src/config/schema.js";
import { validConfig } from "../helpers.js";

const home = "/home/me";

function issuesOf(raw: unknown, env: NodeJS.ProcessEnv = {}): string[] {
  try {
    parseConfig(raw, env, home);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as ConfigError).issues;
  }
  throw new Error("expected parseConfig to throw");
}

function expectIssueAt(issues: string[], path: string): void {
  expect(issues).toContainEqual(expect.stringMatching(new RegExp(`^${path.replace(/\./g, "\\.")}: `)));
}

describe("parseConfig top level", () => {
  it("fills in the defaults", () => {
    const config = parseConfig(validConfig(), {}, home);
    expect(config.retentionDays).toBe(30);
    expect(config.dataRootMinFreeBytes).toBe(1073741824);
    expect(config.trackers).toEqual({});
    expect(config.limits.planTimeoutMin).toBe(30);
    expect(config.limits.executeTimeoutMin).toBe(90);
  });

  it("keeps the values that the file gives", () => {
    const raw = validConfig();
    raw.retentionDays = 7;
    raw.dataRootMinFreeBytes = 5;
    raw.limits.planTimeoutMin = 1;
    raw.limits.executeTimeoutMin = 2;
    const config = parseConfig(raw, {}, home);
    expect(config.retentionDays).toBe(7);
    expect(config.dataRootMinFreeBytes).toBe(5);
    expect(config.limits).toEqual({
      bootstrapTimeoutMin: 10,
      verifyTimeoutMin: 20,
      planTimeoutMin: 1,
      executeTimeoutMin: 2,
    });
  });

  it("expands ~ in dataRoot", () => {
    const raw = validConfig();
    raw.dataRoot = "~/data";
    expect(parseConfig(raw, {}, home).dataRoot).toBe("/home/me/data");
  });

  it("expands environment variables in dataRoot", () => {
    const raw = validConfig();
    raw.dataRoot = "$ROOT/t";
    expect(parseConfig(raw, { ROOT: "/srv" }, home).dataRoot).toBe("/srv/t");
  });

  it("rejects a relative dataRoot", () => {
    const raw = validConfig();
    raw.dataRoot = "data";
    expect(issuesOf(raw)).toContainEqual(
      expect.stringMatching(/^dataRoot: must resolve to an absolute path/),
    );
  });

  it("rejects a dataRoot with an undefined variable", () => {
    const raw = validConfig();
    raw.dataRoot = "$UNSET/x";
    expect(issuesOf(raw)).toContainEqual(expect.stringMatching(/^dataRoot: .*\$UNSET/));
  });

  it.each([
    ["dataRoot", (raw: Record<string, unknown>) => delete raw.dataRoot],
    ["limits", (raw: Record<string, unknown>) => delete raw.limits],
    ["repos", (raw: Record<string, unknown>) => delete raw.repos],
    [
      "limits.verifyTimeoutMin",
      (raw: Record<string, unknown>) =>
        delete (raw.limits as Record<string, unknown>).verifyTimeoutMin,
    ],
  ])("reports a missing %s", (path, remove) => {
    const raw = validConfig();
    remove(raw);
    expectIssueAt(issuesOf(raw), path);
  });

  it("rejects a verifyTimeoutMin of 0", () => {
    const raw = validConfig();
    raw.limits.verifyTimeoutMin = 0;
    expectIssueAt(issuesOf(raw), "limits.verifyTimeoutMin");
  });

  it("rejects unknown keys", () => {
    const raw = validConfig();
    raw.bogus = 1;
    raw.limits.bogus = 1;
    const issues = issuesOf(raw);
    expect(issues).toContain("bogus: unrecognized key");
    expect(issues).toContain("limits.bogus: unrecognized key");
  });

  it("reports every problem at once", () => {
    const raw = validConfig();
    raw.dataRoot = "data";
    raw.limits.verifyTimeoutMin = 0;
    const issues = issuesOf(raw);
    expect(issues).toHaveLength(2);
    expectIssueAt(issues, "dataRoot");
    expectIssueAt(issues, "limits.verifyTimeoutMin");
  });

  it("formats the message with one line for each issue", () => {
    const raw = validConfig();
    raw.bogus = 1;
    raw.limits.bogus = 1;
    try {
      parseConfig(raw, {}, home);
    } catch (error) {
      const config = error as ConfigError;
      expect(config.issues).toHaveLength(2);
      expect(config.message).toBe(
        `Invalid configuration:\n${config.issues.map((line) => `  - ${line}`).join("\n")}`,
      );
      return;
    }
    throw new Error("expected parseConfig to throw");
  });

  it("rejects a landing key with one clear issue", () => {
    const raw = validConfig();
    raw.landing = { mergeMethod: "squash" };
    expect(issuesOf(raw)).toEqual([
      "landing: is not accepted: there is no landing setting; the command you run picks how a task lands",
    ]);
  });
});

describe("parseConfig repos", () => {
  it("fills in the defaults of a repo", () => {
    const repo = parseConfig(validConfig(), {}, home).repos.tasker as Record<string, unknown>;
    expect(repo.bootstrap).toEqual({ commands: [], env: [] });
    expect((repo.verify as { env: string[] }).env).toEqual([]);
    expect(repo.overagePolicy).toBe("decline");
    expect(repo.quotaApprovalThreshold).toBe(0.9);
    expect(repo.updateBranchStrategy).toBe("rebase");
  });

  it("defaults the forge merge method", () => {
    const raw = validConfig();
    raw.repos.tasker.forge = { provider: "github", account: "me" };
    const repo = parseConfig(raw, {}, home).repos.tasker as { forge: unknown };
    expect(repo.forge).toEqual({ provider: "github", account: "me", mergeMethod: "merge" });
  });

  it("rejects an empty verify.commands", () => {
    const raw = validConfig();
    raw.repos.tasker.verify.commands = [];
    expectIssueAt(issuesOf(raw), "repos.tasker.verify.commands");
  });

  it("rejects a missing remote", () => {
    const raw = validConfig();
    delete raw.repos.tasker.remote;
    expectIssueAt(issuesOf(raw), "repos.tasker.remote");
  });

  it("rejects a typo in a nested key", () => {
    const raw = validConfig();
    raw.repos.tasker.verify = { comands: ["npm test"] };
    expect(issuesOf(raw)).toContain("repos.tasker.verify.comands: unrecognized key");
  });

  it("rejects a git block as an unknown key", () => {
    const raw = validConfig();
    raw.repos.tasker.git = {};
    expect(issuesOf(raw)).toContain("repos.tasker.git: unrecognized key");
  });

  it("puts a repo key with a slash into the path as it is", () => {
    const raw = validConfig();
    raw.repos["codeguru42/tasker"] = raw.repos.tasker;
    delete raw.repos.tasker;
    raw.repos["codeguru42/tasker"].verify.commands = [];
    expectIssueAt(issuesOf(raw), "repos.codeguru42/tasker.verify.commands");
  });

  it.each([
    ["overagePolicy", "maybe", "repos.tasker.overagePolicy"],
    ["quotaApprovalThreshold", 0, "repos.tasker.quotaApprovalThreshold"],
    ["quotaApprovalThreshold", 1.5, "repos.tasker.quotaApprovalThreshold"],
    ["updateBranchStrategy", "squash", "repos.tasker.updateBranchStrategy"],
    ["verify", ["npm test"], "repos.tasker.verify"],
    ["forge", { provider: "gitlab", account: "me" }, "repos.tasker.forge.provider"],
    ["forge", { provider: "github" }, "repos.tasker.forge.account"],
  ])("rejects a bad %s (%j)", (key, value, path) => {
    const raw = validConfig();
    raw.repos.tasker[key] = value;
    expectIssueAt(issuesOf(raw), path);
  });
});
