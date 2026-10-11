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

  it("rejects a landing key with one clear issue and keeps the other errors", () => {
    const raw = validConfig();
    raw.landing = { mergeMethod: "squash" };
    raw.limits.verifyTimeoutMin = 0;
    const issues = issuesOf(raw);
    expect(issues.filter((line) => line.startsWith("landing"))).toEqual([
      "landing: is not accepted: there is no landing setting; the command you run picks how a task lands",
    ]);
    expectIssueAt(issues, "limits.verifyTimeoutMin");
  });

  it("reports the errors of the steps before the schema together with the schema errors", () => {
    const raw = validConfig();
    raw.landing = {};
    raw.limits.verifyTimeoutMin = 0;
    raw.repos.tasker.verify = { commands: ["npm run check"], comands: ["x"] };
    raw.repos.tasker.issueTracker = { tracker: "nope" };
    const issues = issuesOf(raw);
    expect(issues).toHaveLength(4);
    expect(issues).toContain(
      "landing: is not accepted: there is no landing setting; the command you run picks how a task lands",
    );
    expect(issues).toContainEqual(
      expect.stringMatching(
        /^repos\.tasker\.issueTracker\.tracker: names tracker 'nope', which is not defined under trackers/,
      ),
    );
    expectIssueAt(issues, "limits.verifyTimeoutMin");
    expect(issues).toContain("repos.tasker.verify.comands: unrecognized key");
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

type Repo = { issueTracker: Record<string, unknown>; assistant: Record<string, unknown> };

function parsedRepo(raw: unknown): Repo {
  return parseConfig(raw, {}, home).repos.tasker as unknown as Repo;
}

describe("parseConfig issueTracker", () => {
  it("fills in the defaults", () => {
    const tracker = parsedRepo(validConfig()).issueTracker;
    expect(tracker.updateOnStart).toBe(false);
    expect(tracker.updateOnFinish).toBe(false);
    expect(tracker.assignee).toBe("@me");
  });

  it("stores site in lower case", () => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker = { provider: "jira", site: "ACME.atlassian.net" };
    expect(parsedRepo(raw).issueTracker.site).toBe("acme.atlassian.net");
  });

  it("rejects a missing provider", () => {
    const raw = validConfig();
    delete raw.repos.tasker.issueTracker.provider;
    expectIssueAt(issuesOf(raw), "repos.tasker.issueTracker.provider");
  });

  it("rejects an unknown provider", () => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker.provider = "gitlab";
    expectIssueAt(issuesOf(raw), "repos.tasker.issueTracker.provider");
  });

  it("rejects an unknown key", () => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker.bogus = 1;
    expect(issuesOf(raw)).toContain("repos.tasker.issueTracker.bogus: unrecognized key");
  });

  it("rejects an empty match", () => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker.match = {};
    expect(issuesOf(raw)).toContain(
      "repos.tasker.issueTracker.match: must name labels or components",
    );
  });

  it("rejects empty match labels", () => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker.match = { labels: [] };
    expectIssueAt(issuesOf(raw), "repos.tasker.issueTracker.match.labels");
  });
});

describe("parseConfig assistant", () => {
  it("fills in the defaults", () => {
    const assistant = parsedRepo(validConfig()).assistant;
    expect(assistant.trustedExtensions).toEqual([]);
    expect(assistant.correctiveTurns).toBe(1);
  });

  it("rejects an unknown provider", () => {
    const raw = validConfig();
    raw.repos.tasker.assistant.provider = "gpt";
    expectIssueAt(issuesOf(raw), "repos.tasker.assistant.provider");
  });

  it("rejects a missing review model", () => {
    const raw = validConfig();
    delete raw.repos.tasker.assistant.models.review;
    expectIssueAt(issuesOf(raw), "repos.tasker.assistant.models.review");
  });

  it("rejects a model given as a bare string", () => {
    const raw = validConfig();
    raw.repos.tasker.assistant.models.plan = "opus";
    expectIssueAt(issuesOf(raw), "repos.tasker.assistant.models.plan");
  });

  it("rejects an unknown effort", () => {
    const raw = validConfig();
    raw.repos.tasker.assistant.models.plan.effort = "max";
    expectIssueAt(issuesOf(raw), "repos.tasker.assistant.models.plan.effort");
  });

  it.each([-1, 1.5])("rejects correctiveTurns %j", (value) => {
    const raw = validConfig();
    raw.repos.tasker.assistant.correctiveTurns = value;
    expectIssueAt(issuesOf(raw), "repos.tasker.assistant.correctiveTurns");
  });

  it("rejects an assistant given as a bare string", () => {
    const raw = validConfig();
    raw.repos.tasker.assistant = "claude-code";
    expectIssueAt(issuesOf(raw), "repos.tasker.assistant");
  });

  it("rejects an unknown key", () => {
    const raw = validConfig();
    raw.repos.tasker.assistant.model = "opus";
    expect(issuesOf(raw)).toContain("repos.tasker.assistant.model: unrecognized key");
  });
});

function parsedVcs(raw: unknown): unknown {
  return (parseConfig(raw, {}, home).repos.tasker as Record<string, unknown>).vcs;
}

describe("parseConfig vcs", () => {
  it("defaults to git with an empty config when vcs is missing", () => {
    expect(parsedVcs(validConfig())).toEqual({ provider: "git", config: {} });
  });

  it("defaults the provider to git when vcs is empty", () => {
    const raw = validConfig();
    raw.repos.tasker.vcs = {};
    expect(parsedVcs(raw)).toEqual({ provider: "git", config: {} });
  });

  it("keeps the git config", () => {
    const raw = validConfig();
    const config = {
      authorName: "Tasker",
      authorEmail: "tasker@example.com",
      sshKey: "~/.ssh/tasker",
    };
    raw.repos.tasker.vcs = { provider: "git", config };
    expect(parsedVcs(raw)).toEqual({ provider: "git", config });
  });

  it("rejects a provider other than git", () => {
    const raw = validConfig();
    raw.repos.tasker.vcs = { provider: "hg" };
    expectIssueAt(issuesOf(raw), "repos.tasker.vcs.provider");
  });

  it("rejects an unknown key in the git config", () => {
    const raw = validConfig();
    raw.repos.tasker.vcs = { config: { authorname: "Tasker" } };
    expect(issuesOf(raw)).toContain("repos.tasker.vcs.config.authorname: unrecognized key");
  });

  it("rejects a git key next to provider", () => {
    const raw = validConfig();
    raw.repos.tasker.vcs = { provider: "git", sshKey: "~/.ssh/id" };
    expect(issuesOf(raw)).toContain("repos.tasker.vcs.sshKey: unrecognized key");
  });

  it.each(["authorName", "authorEmail", "sshKey"])("rejects an empty %s", (key) => {
    const raw = validConfig();
    raw.repos.tasker.vcs = { config: { [key]: "" } };
    expectIssueAt(issuesOf(raw), `repos.tasker.vcs.config.${key}`);
  });

  it("rejects a vcs given as a bare string", () => {
    const raw = validConfig();
    raw.repos.tasker.vcs = "git";
    const issues = issuesOf(raw);
    expect(issues).not.toContain("repos.tasker.vcs: unrecognized key");
    expectIssueAt(issues, "repos.tasker.vcs");
  });

  it("reports a bad provider together with the other errors of the repo", () => {
    const raw = validConfig();
    raw.repos.tasker.vcs = { provider: "hg" };
    raw.repos.tasker.verify.commands = [];
    const issues = issuesOf(raw);
    expectIssueAt(issues, "repos.tasker.vcs.provider");
    expectIssueAt(issues, "repos.tasker.verify.commands");
  });
});

describe.each(["verify", "bootstrap"])("parseConfig %s.env", (phase) => {
  const at = `repos.tasker.${phase}.env.0`;

  function withEnv(names: string[]): Record<string, unknown> {
    const raw = validConfig();
    raw.repos.tasker[phase] = { ...raw.repos.tasker[phase], env: names };
    return raw;
  }

  it("accepts and keeps an ordinary name", () => {
    const repo = parseConfig(withEnv(["NPM_TOKEN"]), {}, home).repos.tasker as unknown as Record<
      string,
      { env: string[] }
    >;
    expect(repo[phase].env).toEqual(["NPM_TOKEN"]);
  });

  it("rejects a TASKER_ name", () => {
    expect(issuesOf(withEnv(["TASKER_CONFIG"]))).toContain(
      `${at}: must not start with TASKER_: a TASKER_ variable is tasker's own and is never handed to a phase`,
    );
  });

  it.each(["HOME", "NVM_DIR"])("rejects the name %s that every phase receives", (name) => {
    expect(issuesOf(withEnv([name]))).toContain(
      `${at}: must not be a name every phase already receives (such as HOME); remove it from env`,
    );
  });

  it.each(["1BAD", "A-B"])("rejects %s as a variable name", (name) => {
    expect(issuesOf(withEnv([name]))).toContain(`${at}: must be an environment variable name`);
  });
});

describe("parseConfig named trackers", () => {
  const acme = { provider: "jira", updateOnStart: true, inProgressStatus: "In Progress" };

  function withTracker(
    issueTracker: Record<string, unknown>,
    trackers: unknown = { acme },
  ): Record<string, unknown> {
    const raw = validConfig();
    raw.trackers = trackers;
    raw.repos.tasker.issueTracker = issueTracker;
    return raw;
  }

  it("merges the definition into the repo", () => {
    const raw = withTracker({ tracker: "acme", project: "CIR" });
    expect(parsedRepo(raw).issueTracker).toMatchObject({
      provider: "jira",
      updateOnStart: true,
      inProgressStatus: "In Progress",
      project: "CIR",
      tracker: "acme",
      assignee: "@me",
    });
  });

  it("lets a key of the repo win over the definition", () => {
    const raw = withTracker({ tracker: "acme", updateOnStart: false });
    expect(parsedRepo(raw).issueTracker.updateOnStart).toBe(false);
  });

  it("reports an undefined tracker name once", () => {
    const issues = issuesOf(withTracker({ tracker: "nope" }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(
      /^repos\.tasker\.issueTracker\.tracker: names tracker 'nope', which is not defined under trackers/,
    );
  });

  it("rejects provider next to tracker", () => {
    const issues = issuesOf(withTracker({ tracker: "acme", provider: "github" }));
    expect(issues).toContain(
      "repos.tasker.issueTracker.provider: must not be set next to tracker; provider comes from tracker 'acme'",
    );
  });

  it.each(["project", "match", "tracker"])("rejects %s in a definition", (key) => {
    const value = key === "match" ? { labels: ["a"] } : "x";
    const raw = withTracker({ provider: "github" }, { acme: { ...acme, [key]: value } });
    expect(issuesOf(raw)).toContain(`trackers.acme.${key}: unrecognized key`);
  });

  it("reports a bad definition once, even when two repos use it", () => {
    const raw = withTracker({ tracker: "acme" }, { acme: { provider: "gitlab" } });
    raw.repos = {
      tasker: { ...(raw.repos as Record<string, object>).tasker },
      other: { ...(raw.repos as Record<string, object>).tasker },
    };
    const issues = issuesOf(raw);
    expect(issues).toHaveLength(1);
    expectIssueAt(issues, "trackers.acme.provider");
  });

  it("rejects trackers that is not an object", () => {
    const issues = issuesOf(withTracker({ provider: "github" }, []));
    expect(issues).toHaveLength(1);
    expectIssueAt(issues, "trackers");
  });

  it("rejects provider next to tracker when trackers is not an object", () => {
    const issues = issuesOf(withTracker({ tracker: "acme", provider: "github" }, []));
    expect(issues).toHaveLength(2);
    expectIssueAt(issues, "trackers");
    expect(issues).toContain(
      "repos.tasker.issueTracker.provider: must not be set next to tracker; provider comes from tracker 'acme'",
    );
  });

  it("reports a bad provider next to tracker once", () => {
    const issues = issuesOf(withTracker({ tracker: "acme", provider: "gitlab" }));
    expect(issues).toEqual([
      "repos.tasker.issueTracker.provider: must not be set next to tracker; provider comes from tracker 'acme'",
    ]);
  });

  it("reports a bad provider next to an undefined tracker once", () => {
    const issues = issuesOf(withTracker({ tracker: "nope", provider: "gitlab" }));
    expect(issues).toHaveLength(2);
    expectIssueAt(issues, "repos.tasker.issueTracker.tracker");
    expect(issues.filter((line) => line.startsWith("repos.tasker.issueTracker.provider"))).toEqual([
      "repos.tasker.issueTracker.provider: must not be set next to tracker; provider comes from tracker 'nope'",
    ]);
  });

  it("does not change the raw object", () => {
    const raw = withTracker({ tracker: "acme", project: "CIR" });
    const copy = structuredClone(raw);
    parseConfig(raw, {}, home);
    expect(raw).toEqual(copy);
    raw.landing = {};
    const withLanding = structuredClone(raw);
    issuesOf(raw);
    expect(raw).toEqual(withLanding);
  });
});
