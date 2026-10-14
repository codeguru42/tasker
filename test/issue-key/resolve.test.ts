import { describe, expect, it } from "vitest";
import { parseGithubKey } from "../../src/issue-key/github.js";
import { IssueKeyError, type IssueRef } from "../../src/issue-key/ref.js";
import { issueKeyMatches, resolveIssueKey, type ResolveOptions } from "../../src/issue-key/resolve.js";
import { parseConfig } from "../../src/config/schema.js";
import { configWithTrackers, failureOf, threeRepoConfig, type Trackers } from "../helpers.js";

type RefRow = [
  label: string,
  trackers: Trackers,
  rawKey: string,
  options: ResolveOptions,
  expected: IssueRef,
];
type ErrorRow = [
  label: string,
  trackers: Trackers,
  rawKey: string,
  options: ResolveOptions,
  message: string,
];

const GITHUB_MESSAGE = (rawKey: string): string =>
  `not a GitHub issue key: ${JSON.stringify(rawKey)} (expected owner/repo#N)`;

describe("resolveIssueKey", () => {
  function resolveWith(rawKey: string, trackers: Trackers, options: ResolveOptions): IssueRef {
    return resolveIssueKey(rawKey, configWithTrackers(trackers), options);
  }

  // The IssueKeyError of the resolve. It fails the test when the resolve gives a ref.
  function resolveFailure(
    rawKey: string,
    trackers: Trackers,
    options: ResolveOptions,
  ): Promise<IssueKeyError> {
    return failureOf(
      Promise.resolve().then(() => resolveWith(rawKey, trackers, options)),
      IssueKeyError,
    );
  }

  const REF_ROWS: RefRow[] = [
    [
      "the repo key as the project",
      { "codeguru42/tasker": { provider: "github" } },
      "codeguru42/tasker#5",
      {},
      { key: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", shortRef: "issue-5" },
    ],
    [
      "issueTracker.project",
      { tasker: { provider: "github", project: "codeguru42/tasker" } },
      "codeguru42/tasker#5",
      {},
      { key: "codeguru42/tasker#5", repoKey: "tasker", shortRef: "issue-5" },
    ],
    [
      "another case in the key",
      { tasker: { provider: "github", project: "codeguru42/tasker" } },
      "CodeGuru42/Tasker#5",
      {},
      { key: "codeguru42/tasker#5", repoKey: "tasker", shortRef: "issue-5" },
    ],
    [
      "another case in the project",
      { tasker: { provider: "github", project: "CodeGuru42/Tasker" } },
      "codeguru42/tasker#5",
      {},
      { key: "CodeGuru42/Tasker#5", repoKey: "tasker", shortRef: "issue-5" },
    ],
    [
      "a/b next to a/bc",
      { "a/b": { provider: "github" }, "a/bc": { provider: "github" } },
      "a/b#1",
      {},
      { key: "a/b#1", repoKey: "a/b", shortRef: "issue-1" },
    ],
    [
      "a/bc next to a/b",
      { "a/b": { provider: "github" }, "a/bc": { provider: "github" } },
      "a/bc#1",
      {},
      { key: "a/bc#1", repoKey: "a/bc", shortRef: "issue-1" },
    ],
    [
      "a shared project with --repo",
      {
        one: { provider: "github", project: "codeguru42/tasker" },
        two: { provider: "github", project: "codeguru42/tasker" },
      },
      "codeguru42/tasker#5",
      { repo: "two" },
      { key: "codeguru42/tasker#5", repoKey: "two", shortRef: "issue-5" },
    ],
    [
      "--repo that names the one matching repo",
      { "a/b": { provider: "github" }, "c/d": { provider: "github" } },
      "a/b#1",
      { repo: "a/b" },
      { key: "a/b#1", repoKey: "a/b", shortRef: "issue-1" },
    ],
  ];

  const ERROR_ROWS: ErrorRow[] = [
    [
      "a key that is longer than the only project",
      { "a/b": { provider: "github" } },
      "a/bc#1",
      {},
      'no configured repo has the project of issue key "a/bc#1"',
    ],
    [
      "a key that is shorter than the only project",
      { "a/bc": { provider: "github" } },
      "a/b#1",
      {},
      'no configured repo has the project of issue key "a/b#1"',
    ],
    [
      "the Kelvin sign in the project",
      { tasker: { provider: "github", project: "Ka/b" } },
      "ka/b#1",
      {},
      'no configured repo has the project of issue key "ka/b#1"',
    ],
    [
      "a trailing space in the project",
      { tasker: { provider: "github", project: "a/b " } },
      "a/b#1",
      {},
      'no configured repo has the project of issue key "a/b#1"',
    ],
    [
      "another project",
      { "codeguru42/tasker": { provider: "github" } },
      "other/repo#3",
      {},
      'no configured repo has the project of issue key "other/repo#3"',
    ],
    ...["codeguru42/tasker#5 ", " codeguru42/tasker#5", "codeguru42/tasker#0", "codeguru42/tasker#08", "PROJ-8"].map(
      (rawKey): ErrorRow => [
        `the GitHub parser rejects ${JSON.stringify(rawKey)}`,
        { "codeguru42/tasker": { provider: "github" } },
        rawKey,
        {},
        GITHUB_MESSAGE(rawKey),
      ],
    ),
    [
      "a shared project with no --repo",
      {
        one: { provider: "github", project: "codeguru42/tasker" },
        two: { provider: "github", project: "codeguru42/tasker" },
      },
      "codeguru42/tasker#5",
      {},
      'issue key "codeguru42/tasker#5" matches more than one repo ("one", "two"): pass --repo <key> to pick one',
    ],
    [
      "an unknown repo before the parse",
      { "a/b": { provider: "github" } },
      "bad",
      { repo: "nope" },
      'unknown repo "nope": no repo with this key is in the configuration',
    ],
    [
      "the repo name constructor",
      { "codeguru42/tasker": { provider: "github" } },
      "codeguru42/tasker#5",
      { repo: "constructor" },
      'unknown repo "constructor": no repo with this key is in the configuration',
    ],
    [
      "the repo name __proto__",
      { "codeguru42/tasker": { provider: "github" } },
      "codeguru42/tasker#5",
      { repo: "__proto__" },
      'unknown repo "__proto__": no repo with this key is in the configuration',
    ],
    [
      "a repo that is not a match",
      { "a/b": { provider: "github" }, "c/d": { provider: "github" } },
      "a/b#1",
      { repo: "c/d" },
      'repo "c/d" does not have the project of issue key "a/b#1"',
    ],
    [
      "only jira repos and a Jira-shaped key",
      { j1: { provider: "jira" }, j2: { provider: "jira" } },
      "PROJ-8",
      {},
      'no configured repo has the project of issue key "PROJ-8"',
    ],
    [
      "only jira repos and a key that no parser accepts",
      { j1: { provider: "jira" }, j2: { provider: "jira" } },
      "foo",
      {},
      'not a Jira issue key: "foo" (expected PROJ-N or <site>/browse/PROJ-N)',
    ],
    [
      "a github repo then a jira repo, and a key that the jira parser accepts",
      { "a/b": { provider: "github" }, j: { provider: "jira" } },
      "PROJ-8",
      {},
      'no configured repo has the project of issue key "PROJ-8"',
    ],
    [
      "a github repo then a jira repo, and a key that no parser accepts",
      { "a/b": { provider: "github" }, j: { provider: "jira" } },
      "foo",
      {},
      'not a GitHub issue key: "foo" (expected owner/repo#N)',
    ],
    [
      "--repo names a jira repo",
      { j: { provider: "jira" } },
      "PROJ-8",
      { repo: "j" },
      'repo "j" does not have the project of issue key "PROJ-8"',
    ],
  ];

  it.each(REF_ROWS)(
    "holds for any input: %s gives a ref",
    (_label, trackers, rawKey, options, expected) => {
      const result = resolveWith(rawKey, trackers, options);
      expect(result).toStrictEqual(expected);
      // The stored key is a GitHub key, and the short ref has the same number.
      expect(parseGithubKey(result.key, result.repoKey).shortRef).toBe(result.shortRef);
    },
  );

  it.each(ERROR_ROWS)(
    "holds for any input: %s gives an error",
    async (_label, trackers, rawKey, options, message) => {
      const error = await resolveFailure(rawKey, trackers, options);
      expect(error.key).toBe(rawKey);
      expect(error.message).toBe(message);
    },
  );
});

describe("issueKeyMatches", () => {
  const config = parseConfig(threeRepoConfig(), {}, "/home/test");

  it("gives the ref of each repo that has the project of the key, in the order of the configuration", () => {
    expect(issueKeyMatches("codeguru42/tasker#5", config)).toStrictEqual([
      { key: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", shortRef: "issue-5" },
      { key: "codeguru42/tasker#5", repoKey: "fork", shortRef: "issue-5" },
    ]);
  });

  it("gives no ref for a key of an unknown project", () => {
    expect(issueKeyMatches("codeguru42/unknown#5", config)).toEqual([]);
  });

  it("throws the error of the parser when no parser accepts the key", () => {
    const message = GITHUB_MESSAGE("nonsense");
    expect(() => issueKeyMatches("nonsense", config)).toThrow(IssueKeyError);
    expect(() => issueKeyMatches("nonsense", config)).toThrow(message);
    expect(() => resolveIssueKey("nonsense", config)).toThrow(message);
  });
});
