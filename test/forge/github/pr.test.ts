import { describe, expect, it } from "vitest";
import { createGhSession } from "../../../src/github/forge-session.js";
import { createPr as untypedCreatePr } from "../../../src/forge/github/pr.js";
import { isPrMerged as untypedIsPrMerged } from "../../../src/forge/github/pr.js";
import { listOpenPrs as untypedListOpenPrs } from "../../../src/forge/github/pr.js";
import { mergePr as untypedMergePr } from "../../../src/forge/github/pr.js";
import type { CreatePrInput, MergeMethod, OpenPullRequest, PullRequest } from "../../../src/forge/provider.js";
import { failureOf } from "../../helpers/errors.js";
import { forgeGh } from "../../helpers/forge-gh.js";
import type { FakeAnswer } from "../../helpers/fake-commands.js";
import { useTempDir } from "../../helpers/temp.js";

const listOpenPrs = untypedListOpenPrs;
const createPr = untypedCreatePr;
const isPrMerged = untypedIsPrMerged;
const mergePr = untypedMergePr;

const token = "discovery-token-secret";
const head = "feature/discover";
const baseEnvNames = ["HOME", "GH_CONFIG_DIR", "GH_PROMPT_DISABLED", "GH_NO_UPDATE_NOTIFIER", "NO_COLOR"];

function tokenAnswer(): FakeAnswer {
  return { args: ["auth", "token", "--user", "octo"], stdout: `${token}\n` };
}

function pr(number: number, baseRefName = "main", isCrossRepository = false): object {
  return { number, url: `https://github.com/acme/project/pull/${number}`, baseRefName, isCrossRepository };
}

function listCall(
  session: ReturnType<typeof createGhSession>,
  cwd: string,
  targetHead: string,
  env: NodeJS.ProcessEnv,
) {
  return listOpenPrs(session, { cwd, head: targetHead }, env);
}

function createCall(session: ReturnType<typeof createGhSession>, target: CreatePrInput, env: NodeJS.ProcessEnv) {
  return createPr(session, target, env);
}

function mergedCall(session: ReturnType<typeof createGhSession>, number: number, cwd: string, env: NodeJS.ProcessEnv) {
  return isPrMerged(session, number, cwd, env);
}

function mergeCall(
  session: ReturnType<typeof createGhSession>,
  number: number,
  method: MergeMethod,
  headSha: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
) {
  return mergePr(session, number, method, headSha, cwd, env);
}

function setup(answers: readonly FakeAnswer[], dir = useTempDir("tasker-list-open-prs-")) {
  const fake = forgeGh(dir, token, [tokenAnswer(), ...answers], baseEnvNames);
  const env: NodeJS.ProcessEnv = {
    ...fake.env,
    TASKER_PATH: fake.env.PATH,
    TASKER_HOME: "/tasker/home",
    TASKER_GH_CONFIG_DIR: "/tasker/gh-config",
    TASKER_GH_BIN: fake.env.TASKER_GH_BIN,
  };
  return { dir, env, fake, session: createGhSession("octo") };
}

const listArgs = (targetHead: string, limit: number) => [
  "pr",
  "list",
  "--head",
  targetHead,
  "--state",
  "open",
  "--json",
  "number,url,baseRefName,isCrossRepository",
  "--limit",
  String(limit),
];

const title = "Add pull request support\nwith safe merge guards";
const body = "Summary\n\n- Preserve this text.\n- Keep each line.";
const createTarget: CreatePrInput = {
  cwd: "/unused",
  head,
  base: "release/4",
  title,
  body,
};
const createArgs = (target: CreatePrInput) => [
  "pr",
  "create",
  "--head",
  target.head,
  "--base",
  target.base,
  "--title",
  target.title,
  "--body",
  target.body,
];

function errorStrings(value: unknown, seen = new Set<object>()): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Object.getOwnPropertyNames(value).flatMap((name) => {
    try {
      return errorStrings((value as Record<string, unknown>)[name], seen);
    } catch {
      return [];
    }
  });
}

describe("listOpenPrs", () => {
  it("lists origin requests from every base with exact command and isolated environment", async () => {
    const requests = [pr(11, "main"), pr(12, "release/4"), pr(13, "main", true)];
    const { dir, env, fake, session } = setup([{ args: listArgs(head, 100), stdout: JSON.stringify(requests) }]);

    await expect(listCall(session, dir, head, env)).resolves.toEqual([
      { number: 11, url: "https://github.com/acme/project/pull/11", base: "main" },
      { number: 12, url: "https://github.com/acme/project/pull/12", base: "release/4" },
    ] satisfies OpenPullRequest[]);
    const call = fake.calls().find(({ args }) => args[0] === "pr");
    expect(call).toMatchObject({
      args: listArgs(head, 100),
      tokenMatches: true,
      cwd: dir,
      env: {
        HOME: "/tasker/home",
        GH_CONFIG_DIR: "/tasker/gh-config",
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        NO_COLOR: "1",
      },
    });
    expect(JSON.stringify(fake.calls())).not.toContain(token);
    fake.assertAnswered();
  });

  it("returns an empty list when the response is shorter than the limit", async () => {
    const { dir, env, fake, session } = setup([{ args: listArgs(head, 100), stdout: "[]" }]);

    await expect(listCall(session, dir, head, env)).resolves.toEqual([]);
    expect(
      fake
        .calls()
        .filter(({ args }) => args[0] === "pr")
        .map(({ args }) => args),
    ).toEqual([listArgs(head, 100)]);
    fake.assertAnswered();
  });

  it("doubles an exact limit and uses only the final response", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => pr(index + 1));
    const finalPage = [pr(201, "trunk")];
    const { dir, env, fake, session } = setup([
      { args: listArgs(head, 100), stdout: JSON.stringify(firstPage) },
      { args: listArgs(head, 200), stdout: JSON.stringify(finalPage) },
    ]);

    await expect(listCall(session, dir, head, env)).resolves.toEqual([
      { number: 201, url: "https://github.com/acme/project/pull/201", base: "trunk" },
    ]);
    expect(
      fake
        .calls()
        .filter(({ args }) => args[0] === "pr")
        .map(({ args }) => args),
    ).toEqual([listArgs(head, 100), listArgs(head, 200)]);
    fake.assertAnswered();
  });

  it.each([
    ["not an array", "{}"],
    ["invalid JSON", "{"],
    [
      "missing number",
      JSON.stringify([
        { url: "https://github.com/acme/project/pull/1", baseRefName: "main", isCrossRepository: false },
      ]),
    ],
    ["nonpositive number", JSON.stringify([pr(0)])],
    ["missing URL", JSON.stringify([{ number: 1, baseRefName: "main", isCrossRepository: false }])],
    ["missing base", JSON.stringify([{ number: 1, url: "https://example.test/pull/1", isCrossRepository: false }])],
    ["missing repository identity on a fork", JSON.stringify([{ ...pr(1), isCrossRepository: "yes" }])],
  ])("rejects a %s response", async (_label, stdout) => {
    const { dir, env, fake, session } = setup([{ args: listArgs(head, 100), stdout }]);

    const error = await failureOf(listCall(session, dir, head, env), Error);
    expect(error.message).toContain(head);
    expect(fake.calls().some(({ args }) => args[0] === "pr")).toBe(true);
    fake.assertAnswered();
  });

  it("rejects a failed later read without returning an earlier partial list", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => pr(index + 1));
    const { dir, env, fake, session } = setup([
      { args: listArgs(head, 100), stdout: JSON.stringify(firstPage) },
      { args: listArgs(head, 200), stderr: `failure near ${token}`, exitCode: 1 },
    ]);

    const error = await failureOf(listCall(session, dir, head, env), Error);
    expect(error.message).toContain(head);
    expect(error.message).toContain("failure near ***");
    expect(error.message).not.toContain(token);
    expect(
      fake
        .calls()
        .filter(({ args }) => args[0] === "pr")
        .map(({ args }) => args),
    ).toEqual([listArgs(head, 100), listArgs(head, 200)]);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
    fake.assertAnswered();
  });

  it("counts forks toward the limit and requires every field before filtering them", async () => {
    const entries = Array.from({ length: 100 }, (_, index) => pr(index + 1, "main", true));
    entries[99] = { ...pr(100, "main", true), isCrossRepository: "invalid" };
    const { dir, env, fake, session } = setup([{ args: listArgs(head, 100), stdout: JSON.stringify(entries) }]);

    const error = await failureOf(listCall(session, dir, head, env), Error);
    expect(error.message).toContain(head);
    expect(fake.calls().filter(({ args }) => args[0] === "pr")).toHaveLength(1);
    fake.assertAnswered();
  });
});

describe("createPr", () => {
  it("ignores pull URLs without an owner and repository path", async () => {
    const dir = useTempDir("tasker-create-pr-url-path-");
    const target = { ...createTarget, cwd: dir };
    const output = ["https://example.test/pull/234", "  https://github.com/acme/project/pull/42/  ", ""].join("\n");
    const { env, fake, session } = setup([{ args: createArgs(target), stdout: output }], dir);

    await expect(createCall(session, target, env)).resolves.toEqual({
      number: 42,
      url: "https://github.com/acme/project/pull/42/",
    } satisfies PullRequest);
    fake.assertAnswered();
  });

  it("accepts a GitHub Enterprise pull request URL", async () => {
    const dir = useTempDir("tasker-create-pr-enterprise-");
    const target = { ...createTarget, cwd: dir };
    const url = "https://github.enterprise.test/acme/project/pull/42";
    const { env, fake, session } = setup([{ args: createArgs(target), stdout: `  ${url}  ` }], dir);

    await expect(createCall(session, target, env)).resolves.toEqual({ number: 42, url } satisfies PullRequest);
    fake.assertAnswered();
  });

  it("rejects an informational-only response", async () => {
    const dir = useTempDir("tasker-create-pr-info-only-");
    const target = { ...createTarget, cwd: dir };
    const { env, fake, session } = setup(
      [{ args: createArgs(target), stdout: "https://example.test/pull/234 is an example" }],
      dir,
    );

    const error = await failureOf(createCall(session, target, env), Error);
    expect(error.message).toContain(head);
    fake.assertAnswered();
  });

  it("preserves title and body and returns the pull request among informational lines", async () => {
    const dir = useTempDir("tasker-create-pr-");
    const target = { ...createTarget, cwd: dir };
    const output = [
      "Creating pull request for feature/discover into release/4 in acme/project",
      "https://docs.example.test/articles/about-pull-requests is general help",
      "https://github.com/acme/project/pull/234",
      "",
    ].join("\n");
    const { env, fake, session } = setup([{ args: createArgs(target), stdout: output }], dir);

    await expect(createCall(session, target, env)).resolves.toEqual({
      number: 234,
      url: "https://github.com/acme/project/pull/234",
    } satisfies PullRequest);
    const prCalls = fake.calls().filter(({ args }) => args[0] === "pr");
    expect(prCalls).toHaveLength(1);
    expect(prCalls[0]).toMatchObject({
      args: createArgs(target),
      tokenMatches: true,
      cwd: dir,
      env: {
        HOME: "/tasker/home",
        GH_CONFIG_DIR: "/tasker/gh-config",
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        NO_COLOR: "1",
      },
    });
    expect(prCalls.some(({ args }) => args[1] === "list")).toBe(false);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
    fake.assertAnswered();
  });

  it.each([
    ["no pull request URL", "Pull request created successfully"],
    [
      "conflicting pull request URLs",
      "https://github.com/acme/project/pull/234\nhttps://github.com/acme/project/pull/235",
    ],
  ])("rejects %s after one create attempt", async (_label, stdout) => {
    const dir = useTempDir("tasker-create-pr-reject-");
    const target = { ...createTarget, cwd: dir };
    const { env, fake, session } = setup([{ args: createArgs(target), stdout }], dir);

    const error = await failureOf(createCall(session, target, env), Error);
    expect(error.message).toContain(head);
    expect(
      fake
        .calls()
        .filter(({ args }) => args[0] === "pr")
        .map(({ args }) => args),
    ).toEqual([createArgs(target)]);
    expect(error.cause).toBeInstanceOf(Error);
    expect(errorStrings(error).join("\n")).not.toContain(token);
    fake.assertAnswered();
  });

  it("wraps a failed create with a sanitized cause and keeps one attempt", async () => {
    const dir = useTempDir("tasker-create-pr-failure-");
    const target = { ...createTarget, cwd: dir };
    const { env, fake, session } = setup(
      [
        {
          args: createArgs(target),
          stderr: `create failed with ${token}`,
          exitCode: 1,
        },
      ],
      dir,
    );

    const error = await failureOf(createCall(session, target, env), Error);
    expect(error.message).toContain(head);
    expect(error.message).toContain("create failed with ***");
    expect(error.cause).toBeInstanceOf(Error);
    expect(errorStrings(error).join("\n")).not.toContain(token);
    expect(fake.calls().filter(({ args }) => args[0] === "pr")).toHaveLength(1);
    fake.assertAnswered();
  });
});

describe("isPrMerged", () => {
  it.each([
    ["MERGED", true],
    ["OPEN", false],
    ["CLOSED", false],
  ])("returns %s state as %s and ignores extra fields and whitespace", async (state, expected) => {
    const dir = useTempDir("tasker-is-pr-merged-");
    const { env, fake, session } = setup(
      [
        {
          args: ["pr", "view", "42", "--json", "state"],
          stdout: ` \n { "state": "${state}", "url": "https://example.test/pull/42" } \n`,
        },
      ],
      dir,
    );

    await expect(mergedCall(session, 42, dir, env)).resolves.toBe(expected);
    expect(fake.calls().filter(({ args }) => args[0] === "pr")).toEqual([
      expect.objectContaining({
        args: ["pr", "view", "42", "--json", "state"],
        tokenMatches: true,
        cwd: dir,
      }),
    ]);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
    fake.assertAnswered();
  });

  it.each([
    ["invalid JSON", "{"],
    ["missing state", JSON.stringify({ url: "https://example.test/pull/42" })],
    ["nonstring state", JSON.stringify({ state: 42 })],
    ["array response", JSON.stringify([{ state: "MERGED" }])],
  ])("rejects a %s response", async (_label, stdout) => {
    const dir = useTempDir("tasker-is-pr-merged-malformed-");
    const { env, fake, session } = setup([{ args: ["pr", "view", "42", "--json", "state"], stdout }], dir);

    const error = await failureOf(mergedCall(session, 42, dir, env), Error);
    expect(error.message).toContain("42");
    expect(fake.calls().filter(({ args }) => args[0] === "pr")).toHaveLength(1);
    fake.assertAnswered();
  });

  it("wraps a failed state read with its number and safe cause", async () => {
    const dir = useTempDir("tasker-is-pr-merged-failure-");
    const { env, fake, session } = setup(
      [
        {
          args: ["pr", "view", "42", "--json", "state"],
          stderr: `view failed with ${token}`,
          exitCode: 1,
        },
      ],
      dir,
    );

    const error = await failureOf(mergedCall(session, 42, dir, env), Error);
    expect(error.message).toContain("42");
    expect(error.message).toContain("view failed with ***");
    expect(error.cause).toBeInstanceOf(Error);
    expect(errorStrings(error).join("\n")).not.toContain(token);
    expect(fake.calls().filter(({ args }) => args[0] === "pr")).toHaveLength(1);
    fake.assertAnswered();
  });
});

const mergeArgs = (number: number, method: MergeMethod, headSha: string) => [
  "pr",
  "merge",
  String(number),
  `--${method}`,
  "--match-head-commit",
  headSha,
];

describe("mergePr", () => {
  it.each([
    ["merge", ""],
    ["squash", "Merge accepted; completion is still pending."],
    ["rebase", ""],
  ] satisfies [MergeMethod, string][])(
    "requests %s with the expected head and ignores success output",
    async (method, stdout) => {
      const dir = useTempDir("tasker-merge-pr-");
      const headSha = "expected-head-sha-123";
      const { env, fake, session } = setup([{ args: mergeArgs(42, method, headSha), stdout }], dir);

      await expect(mergeCall(session, 42, method, headSha, dir, env)).resolves.toBeUndefined();
      expect(fake.calls().filter(({ args }) => args[0] === "pr")).toEqual([
        expect.objectContaining({
          args: mergeArgs(42, method, headSha),
          tokenMatches: true,
          cwd: dir,
          env: {
            HOME: "/tasker/home",
            GH_CONFIG_DIR: "/tasker/gh-config",
            GH_PROMPT_DISABLED: "1",
            GH_NO_UPDATE_NOTIFIER: "1",
            NO_COLOR: "1",
          },
        }),
      ]);
      expect(fake.calls().some(({ args }) => args[0] === "pr" && args[1] === "view")).toBe(false);
      expect(JSON.stringify(fake.calls())).not.toContain(token);
      fake.assertAnswered();
    },
  );

  it("refuses a changed remote head and does not read completion or retry", async () => {
    const dir = useTempDir("tasker-merge-pr-stale-head-");
    const headSha = "expected-head-sha-123";
    const { env, fake, session } = setup(
      [
        {
          args: mergeArgs(42, "squash", headSha),
          stderr: `expected head does not match current head near ${token}`,
          exitCode: 1,
        },
      ],
      dir,
    );
    fake.setRemoteHead("changed-head-sha-456");

    const error = await failureOf(mergeCall(session, 42, "squash", headSha, dir, env), Error);
    expect(error.message).toContain("42");
    expect(error.message).toContain("expected head does not match current head near ***");
    expect(error.cause).toBeInstanceOf(Error);
    expect(errorStrings(error).join("\n")).not.toContain(token);
    expect(
      fake
        .calls()
        .filter(({ args }) => args[0] === "pr")
        .map(({ args }) => args),
    ).toEqual([mergeArgs(42, "squash", headSha)]);
    fake.assertAnswered();
  });

  it("waits for a delayed command response without polling for merged state", async () => {
    const dir = useTempDir("tasker-merge-pr-delayed-");
    const headSha = "expected-head-sha-123";
    const { env, fake, session } = setup(
      [
        {
          args: mergeArgs(42, "merge", headSha),
          stdout: "The merge request is accepted, but GitHub has not completed it yet.",
          delaySeconds: 0.05,
        },
      ],
      dir,
    );

    await expect(mergeCall(session, 42, "merge", headSha, dir, env)).resolves.toBeUndefined();
    expect(
      fake
        .calls()
        .filter(({ args }) => args[0] === "pr")
        .map(({ args }) => args),
    ).toEqual([mergeArgs(42, "merge", headSha)]);
    expect(fake.calls().some(({ args }) => args[0] === "pr" && args[1] === "view")).toBe(false);
    fake.assertAnswered();
  });
});
