import { describe, expect, it } from "vitest";
import { createGhSession } from "../../../src/github/forge-session.js";
import { listOpenPrs as untypedListOpenPrs } from "../../../src/forge/github/pr.js";
import type { OpenPullRequest } from "../../../src/forge/provider.js";
import { failureOf } from "../../helpers/errors.js";
import { forgeGh } from "../../helpers/forge-gh.js";
import type { FakeAnswer } from "../../helpers/fake-commands.js";
import { useTempDir } from "../../helpers/temp.js";

const listOpenPrs = untypedListOpenPrs as (
  session: ReturnType<typeof createGhSession>,
  target: { cwd: string; head: string },
  env: NodeJS.ProcessEnv,
) => Promise<OpenPullRequest[]>;

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

function setup(answers: readonly FakeAnswer[]) {
  const dir = useTempDir("tasker-list-open-prs-");
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
