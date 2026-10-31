import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../../src/config/schema.js";
import { validConfig } from "../helpers/config.js";
import { configIssuesOf } from "../helpers/errors.js";

const home = "/home/me";

function issuesOf(raw: unknown, env: NodeJS.ProcessEnv = {}): string[] {
  return configIssuesOf(() => parseConfig(raw, env, home));
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
    expect(issuesOf(raw)).toContainEqual(expect.stringMatching(/^dataRoot: must resolve to an absolute path/));
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
      (raw: Record<string, unknown>) => delete (raw.limits as Record<string, unknown>).verifyTimeoutMin,
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
      expect(config.message).toBe(`Invalid configuration:\n${config.issues.map((line) => `  - ${line}`).join("\n")}`);
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

  const BAD_DEFAULT_BASE_BRANCH =
    "repos.tasker.defaultBaseBranch: must name a remote branch, not a local branch in the form refs/heads/<x>";

  it("rejects a defaultBaseBranch in the form refs/heads/<x>", () => {
    const raw = validConfig();
    raw.repos.tasker.defaultBaseBranch = "refs/heads/main";
    expect(issuesOf(raw)).toContain(BAD_DEFAULT_BASE_BRANCH);
  });

  it("reports a bad defaultBaseBranch together with an error in another repo", () => {
    const raw = validConfig();
    raw.repos.tasker.defaultBaseBranch = "refs/heads/main";
    raw.repos.other = structuredClone(raw.repos.tasker);
    raw.repos.other.defaultBaseBranch = "main";
    raw.repos.other.verify.commands = [];
    const issues = issuesOf(raw);
    expect(issues).toContain(BAD_DEFAULT_BASE_BRANCH);
    expectIssueAt(issues, "repos.other.verify.commands");
  });

  it.each(["main", "release/1.0"])("keeps the defaultBaseBranch %s as it is", (name) => {
    const raw = validConfig();
    raw.repos.tasker.defaultBaseBranch = name;
    expect(parseConfig(raw, {}, home).repos.tasker.defaultBaseBranch).toBe(name);
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

interface Repo {
  issueTracker: Record<string, unknown>;
  assistant: Record<string, unknown>;
  sessions: { kind: string; models: Record<string, unknown> };
}

function parsedRepo(raw: unknown): Repo {
  return parseConfig(raw, {}, home).repos.tasker;
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
    raw.repos.tasker.issueTracker = { provider: "jira", project: "TEST", site: "ACME.atlassian.net" };
    expect(parsedRepo(raw).issueTracker.site).toBe("acme.atlassian.net");
  });

  it("folds only the ASCII letters of the site of a github repo", () => {
    const kelvin = String.fromCodePoint(0x212a);
    const raw = validConfig();
    raw.repos.tasker.issueTracker.site = kelvin + "ACME.example.com";
    expect(parsedRepo(raw).issueTracker.site).toBe(kelvin + "acme.example.com");
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

  it.each([
    ["github", {}],
    ["jira", { provider: "jira", project: "TEST" }],
  ])("rejects releaseBranchField on a %s repo", (_name, tracker) => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker = { ...raw.repos.tasker.issueTracker, ...tracker, releaseBranchField: "x" };
    expect(issuesOf(raw)).toContain("repos.tasker.issueTracker.releaseBranchField: unrecognized key");
  });

  it("rejects an empty match", () => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker.match = {};
    expect(issuesOf(raw)).toContain("repos.tasker.issueTracker.match: must name labels or components");
  });

  it("rejects empty match labels", () => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker.match = { labels: [] };
    expectIssueAt(issuesOf(raw), "repos.tasker.issueTracker.match.labels");
  });

  it("rejects a github tracker with no account", () => {
    const raw = validConfig();
    delete raw.repos.tasker.issueTracker.account;
    expect(issuesOf(raw)).toEqual(["repos.tasker.issueTracker.account: is required for the github tracker"]);
  });

  it("accepts a jira tracker with no account", () => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker = { provider: "jira", project: "TEST" };
    expect(parsedRepo(raw).issueTracker.account).toBeUndefined();
  });

  it("reports the missing account with other errors", () => {
    const raw = validConfig();
    delete raw.repos.tasker.issueTracker.account;
    raw.repos.tasker.verify.commands = [];
    raw.bogus = 1;
    const issues = issuesOf(raw);
    expect(issues).toContain("repos.tasker.issueTracker.account: is required for the github tracker");
    expectIssueAt(issues, "repos.tasker.verify.commands");
    expect(issues).toContain("bogus: unrecognized key");
  });

  it("reports the account, an empty verify.commands and an unknown key of one repo together", () => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker = { provider: "github" };
    raw.repos.tasker.verify.commands = [];
    raw.repos.tasker.bogus = 1;
    const issues = issuesOf(raw);
    expect(issues).toHaveLength(3);
    expect(issues).toContain("repos.tasker.issueTracker.account: is required for the github tracker");
    expectIssueAt(issues, "repos.tasker.verify.commands");
    expect(issues).toContain("repos.tasker.bogus: unrecognized key");
  });

  const commaKeys = ["assignee", "inProgressLabel", "doneLabel"] as const;
  const commaCases = commaKeys.flatMap((name) =>
    [",team-a", "in progress, team-a", "team-a,"].map((value) => [name, value] as const),
  );

  it.each(commaCases)("rejects a comma in %s of the github tracker: %j", (name, value) => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker[name] = value;
    expect(issuesOf(raw)).toEqual([
      `repos.tasker.issueTracker.${name}: must not contain a comma for the github tracker`,
    ]);
  });

  it.each([
    ["assignee", "octocat"],
    ["inProgressLabel", "in progress"],
    ["doneLabel", "in progress"],
  ] as const)("accepts %s with no comma: %j", (name, value) => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker[name] = value;
    expect(parsedRepo(raw).issueTracker[name]).toBe(value);
  });

  it("reports the commas with other errors", () => {
    const raw = validConfig();
    raw.repos.tasker.issueTracker.inProgressLabel = "a,b";
    raw.repos.tasker.issueTracker.doneLabel = "c,d";
    raw.repos.tasker.verify.commands = [];
    raw.bogus = 1;
    const issues = issuesOf(raw);
    expect(issues).toContain(
      "repos.tasker.issueTracker.inProgressLabel: must not contain a comma for the github tracker",
    );
    expect(issues).toContain("repos.tasker.issueTracker.doneLabel: must not contain a comma for the github tracker");
    expectIssueAt(issues, "repos.tasker.verify.commands");
    expect(issues).toContain("bogus: unrecognized key");
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

  it.each(["plan", "execute", "review"])("rejects a claude-code model of an unknown form in %s", (role) => {
    const raw = validConfig();
    raw.repos.tasker.assistant.models[role].model = "gpt-5";
    expect(issuesOf(raw)).toEqual([`repos.tasker.assistant.models.${role}.model: is not a claude-code model: gpt-5`]);
  });

  it("accepts an alias with the 1m suffix and a full id", () => {
    const raw = validConfig();
    raw.repos.tasker.assistant.models.plan.model = "opus[1m]";
    raw.repos.tasker.assistant.models.execute.model = "claude-opus-5-5";
    expect(() => parseConfig(raw, {}, home)).not.toThrow();
  });

  it.each(["copilot", "pi"])("accepts any model for %s", (provider) => {
    const raw = validConfig();
    raw.repos.tasker.assistant.provider = provider;
    raw.repos.tasker.assistant.models.plan.model = "gpt-5";
    expect(() => parseConfig(raw, {}, home)).not.toThrow();
  });

  it("reports a bad model together with the other errors of the repo", () => {
    const raw = validConfig();
    delete raw.repos.tasker.verify;
    raw.repos.tasker.assistant.models.plan.effort = "max";
    raw.repos.tasker.assistant.models.execute.model = "gpt-5";
    raw.repos.tasker.bogus = 1;
    const issues = issuesOf(raw);
    expectIssueAt(issues, "repos.tasker.verify");
    expectIssueAt(issues, "repos.tasker.assistant.models.plan.effort");
    expect(issues).toContain("repos.tasker.assistant.models.execute.model: is not a claude-code model: gpt-5");
    expect(issues).toContain("repos.tasker.bogus: unrecognized key");
  });

  it("reports a bad model in a second repo under its own key", () => {
    const raw = validConfig();
    raw.repos.other = structuredClone(raw.repos.tasker);
    raw.repos.other.assistant.models.plan.model = "gpt-5";
    expect(issuesOf(raw)).toEqual(["repos.other.assistant.models.plan.model: is not a claude-code model: gpt-5"]);
  });

  describe("model check on a partly valid repo", () => {
    it("adds no model issue when the repo is a string", () => {
      const raw = validConfig();
      raw.repos.tasker = "x";
      expect(issuesOf(raw)).toEqual(["repos.tasker: Invalid input: expected object, received string"]);
    });

    it("adds no model issue when assistant is a string", () => {
      const raw = validConfig();
      raw.repos.tasker.assistant = "claude-code";
      expect(issuesOf(raw)).toEqual(["repos.tasker.assistant: Invalid input: expected object, received string"]);
    });

    it("adds no model issue when models is missing", () => {
      const raw = validConfig();
      delete raw.repos.tasker.assistant.models;
      expect(issuesOf(raw)).toEqual([
        "repos.tasker.assistant.models: Invalid input: expected object, received undefined",
      ]);
    });

    it("adds no model issue when plan is a string", () => {
      const raw = validConfig();
      raw.repos.tasker.assistant.models.plan = "opus";
      expect(issuesOf(raw)).toEqual([
        "repos.tasker.assistant.models.plan: Invalid input: expected object, received string",
      ]);
    });

    it("adds no model issue when the model is empty", () => {
      const raw = validConfig();
      raw.repos.tasker.assistant.models.plan.model = "";
      expect(issuesOf(raw)).toEqual([
        "repos.tasker.assistant.models.plan.model: Too small: expected string to have >=1 characters",
      ]);
    });

    it("adds no model issue when the provider is bad", () => {
      const raw = validConfig();
      raw.repos.tasker.assistant.provider = "gpt";
      raw.repos.tasker.assistant.models.plan.model = "gpt-5";
      expect(issuesOf(raw)).toEqual([
        'repos.tasker.assistant.provider: Invalid option: expected one of "claude-code"|"copilot"|"pi"',
      ]);
    });
  });
});

describe("parseConfig sessions", () => {
  const sessionRoles = ["operator", "planner", "orchestrator"];

  it("fills in the defaults when sessions is missing", () => {
    expect(parsedRepo(validConfig()).sessions).toEqual({ kind: "claude", models: {} });
  });

  it("fills in kind and models when sessions is empty", () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = {};
    expect(parsedRepo(raw).sessions).toEqual({ kind: "claude", models: {} });
  });

  it("keeps the model and the effort of each role", () => {
    const raw = validConfig();
    const models = {
      operator: { model: "opus", effort: "max" },
      planner: { model: "claude-opus-5-5", effort: "xhigh" },
      orchestrator: { model: "sonnet[1m]", effort: "low" },
    };
    raw.repos.tasker.sessions = { models };
    expect(parsedRepo(raw).sessions.models).toEqual(models);
  });

  it("gives no entry to a role that the file leaves out", () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = { models: { planner: { model: "opus", effort: "high" } } };
    expect(Object.keys(parsedRepo(raw).sessions.models)).toEqual(["planner"]);
  });

  it("rejects a kind other than claude", () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = { kind: "codex" };
    expectIssueAt(issuesOf(raw), "repos.tasker.sessions.kind");
  });

  it("rejects an unknown key", () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = {
      bogus: 1,
      models: {
        reviewer: { model: "opus", effort: "high" },
        operator: { model: "opus", effort: "high", extra: 1 },
      },
    };
    const issues = issuesOf(raw);
    expect(issues).toContain("repos.tasker.sessions.bogus: unrecognized key");
    expect(issues).toContain("repos.tasker.sessions.models.reviewer: unrecognized key");
    expect(issues).toContain("repos.tasker.sessions.models.operator.extra: unrecognized key");
  });

  it("rejects a missing model and a missing effort", () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = { models: { operator: {} } };
    const issues = issuesOf(raw);
    expectIssueAt(issues, "repos.tasker.sessions.models.operator.model");
    expectIssueAt(issues, "repos.tasker.sessions.models.operator.effort");
  });

  it("rejects an empty model", () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = { models: { operator: { model: "", effort: "high" } } };
    expect(issuesOf(raw)).toEqual([
      "repos.tasker.sessions.models.operator.model: Too small: expected string to have >=1 characters",
    ]);
  });

  it("rejects an unknown effort", () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = { models: { operator: { model: "opus", effort: "extreme" } } };
    expectIssueAt(issuesOf(raw), "repos.tasker.sessions.models.operator.effort");
  });

  it("rejects a role given as a bare string", () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = { models: { planner: "opus" } };
    expect(issuesOf(raw)).toEqual([
      "repos.tasker.sessions.models.planner: Invalid input: expected object, received string",
    ]);
  });

  it("rejects sessions given as a bare string", () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = "claude";
    expect(issuesOf(raw)).toEqual(["repos.tasker.sessions: Invalid input: expected object, received string"]);
  });

  it.each(sessionRoles)("rejects a claude model of an unknown form in %s", (role) => {
    const raw = validConfig();
    raw.repos.tasker.sessions = { models: { [role]: { model: "gpt-5", effort: "high" } } };
    expect(issuesOf(raw)).toEqual([`repos.tasker.sessions.models.${role}.model: is not a claude-code model: gpt-5`]);
  });

  it("adds no model issue when the kind is bad", () => {
    const raw = validConfig();
    raw.repos.tasker.sessions = { kind: "codex", models: { planner: { model: "gpt-5", effort: "high" } } };
    const issues = issuesOf(raw);
    expect(issues).toHaveLength(1);
    expectIssueAt(issues, "repos.tasker.sessions.kind");
  });

  it("reports a bad session model together with the other errors of the file", () => {
    const raw = validConfig();
    delete raw.repos.tasker.verify;
    raw.repos.tasker.sessions = {
      models: {
        operator: { model: "opus", effort: "huge" },
        planner: { model: "gpt-5", effort: "high" },
      },
    };
    raw.bogus = 1;
    const issues = issuesOf(raw);
    expectIssueAt(issues, "repos.tasker.verify");
    expectIssueAt(issues, "repos.tasker.sessions.models.operator.effort");
    expect(issues).toContain("repos.tasker.sessions.models.planner.model: is not a claude-code model: gpt-5");
    expect(issues).toContain("bogus: unrecognized key");
  });

  it("reports a bad session model in a second repo under its own key", () => {
    const raw = validConfig();
    raw.repos.other = structuredClone(raw.repos.tasker);
    raw.repos.other.sessions = { models: { planner: { model: "gpt-5", effort: "high" } } };
    expect(issuesOf(raw)).toEqual(["repos.other.sessions.models.planner.model: is not a claude-code model: gpt-5"]);
  });

  it("reports a bad assistant model and a bad session model together", () => {
    const raw = validConfig();
    raw.repos.tasker.assistant.models.plan.model = "gpt-5";
    raw.repos.tasker.sessions = { models: { operator: { model: "gpt-5", effort: "high" } } };
    const issues = issuesOf(raw);
    expect(issues).toContain("repos.tasker.assistant.models.plan.model: is not a claude-code model: gpt-5");
    expect(issues).toContain("repos.tasker.sessions.models.operator.model: is not a claude-code model: gpt-5");
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

  it("reports every vcs error together with the other errors of the repo", () => {
    const raw = validConfig();
    raw.repos.tasker.vcs = { provider: "git", config: { authorname: "x", sshKey: "" }, sshKey: "y" };
    raw.repos.tasker.verify.commands = [];
    const issues = issuesOf(raw);
    expect(issues).toHaveLength(4);
    expect(issues).toContain("repos.tasker.vcs.config.authorname: unrecognized key");
    expectIssueAt(issues, "repos.tasker.vcs.config.sshKey");
    expect(issues).toContain("repos.tasker.vcs.sshKey: unrecognized key");
    expectIssueAt(issues, "repos.tasker.verify.commands");
  });

  it("reports a vcs error together with an error of another repo and of the top level", () => {
    const raw = validConfig();
    raw.repos.other = structuredClone(raw.repos.tasker);
    raw.repos.tasker.vcs = { config: { authorname: "x" } };
    raw.repos.other.verify.commands = [];
    raw.bogus = 1;
    const issues = issuesOf(raw);
    expect(issues).toContain("repos.tasker.vcs.config.authorname: unrecognized key");
    expectIssueAt(issues, "repos.other.verify.commands");
    expect(issues).toContain("bogus: unrecognized key");
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

  function withTracker(issueTracker: Record<string, unknown>, trackers: unknown = { acme }): Record<string, unknown> {
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

  it("folds only the ASCII letters of the site of a definition", () => {
    const kelvin = String.fromCodePoint(0x212a);
    const raw = withTracker(
      { tracker: "acme", project: "TEST" },
      { acme: { ...acme, site: kelvin + "ACME.example.com" } },
    );
    expect(parseConfig(raw, {}, home).trackers.acme.site).toBe(kelvin + "acme.example.com");
  });

  it("lets a key of the repo win over the definition", () => {
    const raw = withTracker({ tracker: "acme", project: "TEST", updateOnStart: false });
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

  it("rejects releaseBranchField in a definition", () => {
    const raw = withTracker({ tracker: "acme", project: "TEST" }, { acme: { ...acme, releaseBranchField: "x" } });
    expect(issuesOf(raw)).toContain("trackers.acme.releaseBranchField: unrecognized key");
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
    const issues = issuesOf(withTracker({ provider: "github", account: "codeguru42" }, []));
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
    const issues = issuesOf(withTracker({ tracker: "acme", provider: "gitlab", project: "TEST" }));
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

  it("accepts a github definition with no account when the repo sets it", () => {
    const raw = withTracker({ tracker: "hub", account: "codeguru42" }, { hub: { provider: "github" } });
    expect(parsedRepo(raw).issueTracker.account).toBe("codeguru42");
  });

  it("rejects a github definition when neither the definition nor the repo sets the account", () => {
    const raw = withTracker({ tracker: "hub" }, { hub: { provider: "github" } });
    const issues = issuesOf(raw);
    expect(issues).toEqual(["repos.tasker.issueTracker.account: is required for the github tracker"]);
  });

  it("reports the missing account for each repo that uses the definition", () => {
    const raw = withTracker({ tracker: "hub" }, { hub: { provider: "github" } });
    raw.repos = {
      tasker: { ...(raw.repos as Record<string, object>).tasker },
      other: { ...(raw.repos as Record<string, object>).tasker },
    };
    expect(issuesOf(raw).sort()).toEqual([
      "repos.other.issueTracker.account: is required for the github tracker",
      "repos.tasker.issueTracker.account: is required for the github tracker",
    ]);
  });

  it("rejects a comma in a github definition", () => {
    const raw = withTracker(
      { tracker: "hub", account: "codeguru42" },
      { hub: { provider: "github", inProgressLabel: "a,b" } },
    );
    expect(issuesOf(raw)).toEqual([
      "repos.tasker.issueTracker.inProgressLabel: must not contain a comma for the github tracker",
    ]);
  });

  it("rejects a comma that the repo sets next to a github tracker name", () => {
    const raw = withTracker(
      { tracker: "hub", account: "codeguru42", doneLabel: "a,b" },
      { hub: { provider: "github" } },
    );
    expect(issuesOf(raw)).toEqual([
      "repos.tasker.issueTracker.doneLabel: must not contain a comma for the github tracker",
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

describe("parseConfig skillsDirs", () => {
  function withSkillsDirs(skillsDirs: unknown): Record<string, unknown> {
    return { ...validConfig(), skillsDirs };
  }

  it("gives ~/.claude/skills, expanded, as the default", () => {
    expect(parseConfig(validConfig(), {}, home).skillsDirs).toEqual(["/home/me/.claude/skills"]);
  });

  it("expands ~ and each variable in skillsDirs", () => {
    const raw = withSkillsDirs(["~/a", "$ROOT/b", "${ROOT}/c"]);
    expect(parseConfig(raw, { ROOT: "/srv" }, home).skillsDirs).toEqual(["/home/me/a", "/srv/b", "/srv/c"]);
  });

  it("rejects a relative folder in skillsDirs", () => {
    expect(issuesOf(withSkillsDirs(["/ok", "rel"]))).toContainEqual(
      expect.stringMatching(/^skillsDirs\.1: must resolve to an absolute path/),
    );
  });

  it("rejects a skillsDirs folder with an undefined or empty variable", () => {
    expect(issuesOf(withSkillsDirs(["$UNSET/x"]))).toContainEqual(expect.stringMatching(/^skillsDirs\.0: .*\$UNSET/));
    expect(issuesOf(withSkillsDirs(["$EMPTY/x"]), { EMPTY: "" })).toContainEqual(
      expect.stringMatching(/^skillsDirs\.0: .*\$EMPTY/),
    );
  });

  it("rejects an empty skillsDirs", () => {
    expect(issuesOf(withSkillsDirs([]))).toContain("skillsDirs: Too small: expected array to have >=1 items");
  });

  it("rejects a skillsDirs that is not a list of strings", () => {
    expectIssueAt(issuesOf(withSkillsDirs("~/x")), "skillsDirs");
    expectIssueAt(issuesOf(withSkillsDirs([1])), "skillsDirs.0");
  });

  it("reports each skillsDirs problem with the other problems in one run", () => {
    const raw = { ...withSkillsDirs(["rel", "$UNSET/x"]), dataRoot: "data" };
    const issues = issuesOf(raw);
    expect(issues).toHaveLength(3);
    expectIssueAt(issues, "skillsDirs.0");
    expectIssueAt(issues, "skillsDirs.1");
    expectIssueAt(issues, "dataRoot");
  });
});
