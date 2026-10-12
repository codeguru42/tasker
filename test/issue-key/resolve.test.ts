import { describe, expect, it } from "vitest";
import { parseConfig, type Config } from "../../src/config/schema.js";
import { parseGithubKey } from "../../src/issue-key/github.js";
import { IssueKeyError, type IssueRef } from "../../src/issue-key/ref.js";
import { resolveIssueKey, type ResolveOptions } from "../../src/issue-key/resolve.js";
import { failureOf, validConfig } from "../helpers.js";

type Trackers = Record<string, Record<string, unknown>>;
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
  // A parsed configuration with one repo for each entry of trackers. Each repo copies the
  // repo of validConfig() and takes the issueTracker of its entry.
  function configWith(trackers: Trackers): Config {
    const raw = validConfig();
    const base = raw.repos.tasker;
    raw.repos = Object.fromEntries(
      Object.entries(trackers).map(([key, issueTracker]) => [key, { ...base, issueTracker }]),
    );
    return parseConfig(raw, {}, "/home/test");
  }

  function resolveWith(rawKey: string, trackers: Trackers, options: ResolveOptions): IssueRef {
    return resolveIssueKey(rawKey, configWith(trackers), options);
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
