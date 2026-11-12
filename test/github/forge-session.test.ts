import { relative, join } from "node:path";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGhSession } from "../../src/github/forge-session.js";
import { diagnosticStrings, failureOf, thrownBy } from "../helpers/errors.js";
import { forgeGh } from "../helpers/forge-gh.js";
import { writeFakeCommand } from "../helpers/fake-commands.js";
import { startFixture } from "../helpers/processes.js";
import { useProcessEnv, useTempDir } from "../helpers/temp.js";

const answer = { args: ["repo", "view"], stdout: "repository" };
const forgeToken = "forge-token-secret";
const tokenAnswer = (account: string, stdout = `${forgeToken}\n`, exitCode = 0) => ({
  args: ["auth", "token", "--user", account],
  stdout,
  exitCode,
});
const taskerEnv = (ghPath: string | undefined, rest: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  TASKER_PATH: ghPath,
  TASKER_HOME: "/tasker/home",
  TASKER_GH_CONFIG_DIR: "/tasker/gh-config",
  ...rest,
});
type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;
export const runParametersAreExact: Equal<
  Parameters<ReturnType<typeof createGhSession>["run"]>,
  [args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }]
> = true;
const run = (
  session: ReturnType<typeof createGhSession>,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) => session.run(args, { cwd, env });

function expectNoToken(error: Error, token: string): void {
  expect(diagnosticStrings(error).join("\n")).not.toContain(token);
}

describe("createGhSession", () => {
  it("throws for an empty account during construction", () => {
    const error = thrownBy(() => createGhSession(""), "an empty-account error");
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("account");
  });

  it.each([
    ["auth token", ["auth", "token"]],
    ["auth login", ["auth", "login"]],
    ["auth logout", ["auth", "logout"]],
    ["auth switch", ["auth", "switch"]],
    ["pr checkout", ["pr", "checkout", "42"]],
    ["repo sync", ["repo", "sync", "owner/repo"]],
    ...["--push", "--push=1", "--push=t", "--push=T", "--push=true", "--push=TRUE", "--push=True"].map(
      (push): [string, string[]] => [`repo create with ${push}`, ["repo", "create", "new-repo", push]],
    ),
    ["empty args", []],
    ["flag first", ["--repo", "owner/repo"]],
  ])("rejects %s before starting gh", async (_label, args) => {
    const dir = useTempDir("tasker-forge-filter-");
    const fake = forgeGh(dir, "token", []);
    const error = await failureOf(run(createGhSession("octo"), args, dir, taskerEnv(fake.env.PATH)), Error);
    expect(error.message).not.toBe("");
    expect(fake.calls()).toEqual([]);
  });

  it("accepts an unrelated repository command", async () => {
    const dir = useTempDir("tasker-forge-accepted-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo"), answer]);

    await expect(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH))).resolves.toBe(
      "repository",
    );
    expect(fake.calls().map((call) => call.args)).toEqual([tokenAnswer("octo").args, ["repo", "view"]]);
  });

  it.each(["--push=false", "--push=0"])("accepts repo create with %s", async (push) => {
    const dir = useTempDir("tasker-forge-create-no-push-");
    const createAnswer = { args: ["repo", "create", "new-repo", push], stdout: "created" };
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo"), createAnswer]);

    await expect(run(createGhSession("octo"), createAnswer.args, dir, taskerEnv(fake.env.PATH))).resolves.toBe(
      "created",
    );
    expect(fake.calls().map((call) => call.args)).toEqual([tokenAnswer("octo").args, createAnswer.args]);
  });

  it("reports a missing worktree before reading the account token", async () => {
    const dir = useTempDir("tasker-forge-missing-worktree-");
    const fake = forgeGh(dir, "", []);
    const missingWorktree = join(dir, "missing-worktree");

    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], missingWorktree, taskerEnv(fake.env.PATH)),
      Error,
    );

    expect(error.message).toContain(missingWorktree);
    expect(fake.calls()).toEqual([]);
  });

  it("reports a missing gh executable when PATH is unset", async () => {
    const dir = useTempDir("tasker-forge-no-path-");
    const fake = forgeGh(dir, "token", []);
    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], dir, { TASKER_GH_BIN: fake.env.TASKER_GH_BIN }),
      Error,
    );
    expect(error.message).toContain("Install gh or set TASKER_GH_BIN to a runnable file");
    expect(fake.calls()).toEqual([]);
  });

  it("reports a missing login when gh has no authentication location", async () => {
    const dir = useTempDir("tasker-forge-no-auth-location-");
    const fake = forgeGh(dir, "token", [tokenAnswer("octo", "", 1)]);
    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], dir, {
        PATH: fake.env.PATH,
        TASKER_GH_BIN: fake.env.TASKER_GH_BIN,
      }),
      Error,
    );
    expect(error.message).toContain("gh has no login for the account octo");
    expect(fake.calls().map((call) => call.args)).toEqual([tokenAnswer("octo").args]);
  });

  it.each(["TASKER_GH_TOKEN", "TASKER_GH_HOST", "TASKER_GH_REPO"])("rejects supplied %s", async (name) => {
    const dir = useTempDir("tasker-forge-forbidden-");
    const fake = forgeGh(dir, "token", []);
    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH, { [name]: "bad" })),
      Error,
    );
    expect(error.message).toContain(name);
    expect(fake.calls()).toEqual([]);
  });

  it("uses only the allowlisted environment and fixed controls, with the supplied worktree", async () => {
    const dir = useTempDir("tasker-forge-environment-");
    const worktree = `${dir}/worktree`;
    mkdirSync(worktree);
    const fake = forgeGh(
      dir,
      forgeToken,
      [tokenAnswer("octo"), answer],
      [
        "PATH",
        "HOME",
        "XDG_CONFIG_HOME",
        "GH_CONFIG_DIR",
        "TASKER_GH_CONFIG_DIR",
        "TASKER_GH_BIN",
        "GH_HOST",
        "GH_REPO",
        "OUTSIDE_ALLOWLIST",
        "GH_PROMPT_DISABLED",
        "GH_NO_UPDATE_NOTIFIER",
        "NO_COLOR",
        "HOME",
      ],
    );
    useProcessEnv({ PATH: "/ambient/path", HOME: "/ambient/home", GH_TOKEN: "ambient-token" });
    const processEnvBefore = { PATH: process.env.PATH, HOME: process.env.HOME, GH_TOKEN: process.env.GH_TOKEN };
    const supplied = taskerEnv(fake.env.PATH, {
      TASKER_GH_TOKEN: undefined,
      TASKER_GH_HOST: undefined,
      TASKER_GH_REPO: undefined,
      GH_TOKEN: forgeToken,
      GH_HOST: "ambient.example",
      GH_REPO: "ambient/repo",
      GH_CONFIG_DIR: "/caller/gh-config",
      XDG_CONFIG_HOME: "/caller/xdg-config",
      OUTSIDE_ALLOWLIST: "caller-value",
      HOME: "/caller/home",
      PATH: "/caller/path",
      TASKER_GH_BIN: fake.env.TASKER_GH_BIN,
    });
    const before = { ...supplied };

    await run(createGhSession("octo"), ["repo", "view"], worktree, supplied);

    const expectedEnv = {
      PATH: "/caller/path",
      HOME: "/caller/home",
      XDG_CONFIG_HOME: "/caller/xdg-config",
      GH_CONFIG_DIR: "/tasker/gh-config",
      TASKER_GH_CONFIG_DIR: undefined,
      TASKER_GH_BIN: undefined,
      GH_HOST: undefined,
      GH_REPO: undefined,
      OUTSIDE_ALLOWLIST: undefined,
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      NO_COLOR: "1",
    };
    expect(fake.calls()).toEqual([
      {
        args: tokenAnswer("octo").args,
        tokenMatches: false,
        cwd: process.cwd(),
        env: expectedEnv,
      },
      {
        args: ["repo", "view"],
        tokenMatches: true,
        cwd: worktree,
        env: expectedEnv,
      },
    ]);
    expect(supplied).toEqual(before);
    expect({ PATH: process.env.PATH, HOME: process.env.HOME, GH_TOKEN: process.env.GH_TOKEN }).toEqual(
      processEnvBefore,
    );
  });

  it.each([
    ["HOME", { HOME: "/tasker/only-home" }, "HOME", "/tasker/only-home"],
    [
      "TASKER_GH_CONFIG_DIR",
      { TASKER_GH_CONFIG_DIR: "/tasker/only-gh-config" },
      "GH_CONFIG_DIR",
      "/tasker/only-gh-config",
    ],
  ] as const)("maps %s to the child %s when used alone", async (_input, location, childName, childValue) => {
    const dir = useTempDir("tasker-forge-one-location-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo"), answer], ["HOME", "GH_CONFIG_DIR"]);
    const env = { PATH: fake.env.PATH, ...location };

    await run(createGhSession("octo"), ["repo", "view"], dir, env);

    expect(fake.calls().map((call) => call.env)).toEqual([
      {
        HOME: childName === "HOME" ? childValue : undefined,
        GH_CONFIG_DIR: childName === "GH_CONFIG_DIR" ? childValue : undefined,
      },
      {
        HOME: childName === "HOME" ? childValue : undefined,
        GH_CONFIG_DIR: childName === "GH_CONFIG_DIR" ? childValue : undefined,
      },
    ]);
    expect(env).toEqual({ PATH: fake.env.PATH, ...location });
  });

  it.each(["bare", "absolute", "relative", "blank"])("uses a %s executable override", async (kind) => {
    const dir = useTempDir("tasker-forge-program-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo"), answer]);
    const taskerPath = useTempDir("tasker-forge-tasker-path-");
    writeFakeCommand(taskerPath, "selected-gh", `exec "${fake.env.TASKER_GH_BIN!}" "$@"`);
    const path = kind === "bare" ? taskerPath : fake.env.PATH!;
    const executable =
      kind === "bare"
        ? "selected-gh"
        : kind === "absolute"
          ? fake.env.TASKER_GH_BIN
          : kind === "relative"
            ? relative(process.cwd(), fake.env.TASKER_GH_BIN!)
            : "  ";

    await expect(
      run(createGhSession("octo"), ["repo", "view"], dir, {
        ...taskerEnv(path),
        TASKER_GH_BIN: executable,
      }),
    ).resolves.toBe("repository");
    expect(fake.calls().map((call) => call.args)).toEqual([tokenAnswer("octo").args, ["repo", "view"]]);
  });

  it("uses gh from PATH when TASKER_GH_BIN is unset", async () => {
    const dir = useTempDir("tasker-forge-unset-override-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo"), answer]);
    const env = taskerEnv(fake.env.PATH, { TASKER_GH_BIN: undefined });

    await expect(run(createGhSession("octo"), ["repo", "view"], dir, env)).resolves.toBe("repository");
    expect(fake.calls().map((call) => call.args)).toEqual([tokenAnswer("octo").args, ["repo", "view"]]);
  });
});

describe("forge account authentication", () => {
  it("reads the configured account token only when the first repository call starts", async () => {
    const dir = useTempDir("tasker-forge-lazy-token-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("configured"), answer]);
    const session = createGhSession("configured");

    expect(fake.calls()).toEqual([]);
    await run(session, ["repo", "view"], dir, taskerEnv(fake.env.PATH));

    expect(fake.calls().map((call) => call.args)).toEqual([tokenAnswer("configured").args, ["repo", "view"]]);
    expect(fake.calls().map((call) => call.tokenMatches)).toEqual([false, true]);
  });

  it("trims the token before it uses it for the repository call", async () => {
    const dir = useTempDir("tasker-forge-trim-token-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo", ` \n${forgeToken}\n  `), answer]);

    await run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH));

    expect(fake.calls().map((call) => call.tokenMatches)).toEqual([false, true]);
  });

  it("reuses a successful token across sequential calls in one session", async () => {
    const dir = useTempDir("tasker-forge-sequential-token-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo"), answer]);
    const session = createGhSession("octo");

    await run(session, ["repo", "view"], dir, taskerEnv(fake.env.PATH));
    await run(session, ["repo", "view"], dir, taskerEnv(fake.env.PATH));

    expect(fake.calls().map((call) => call.args)).toEqual([
      tokenAnswer("octo").args,
      ["repo", "view"],
      ["repo", "view"],
    ]);
    expect(fake.calls().filter((call) => call.tokenMatches)).toHaveLength(2);
  });

  it("shares a pending token lookup across concurrent calls in one session", async () => {
    const dir = useTempDir("tasker-forge-concurrent-token-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo"), answer]);
    const session = createGhSession("octo");

    await Promise.all([
      run(session, ["repo", "view"], dir, taskerEnv(fake.env.PATH)),
      run(session, ["repo", "view"], dir, taskerEnv(fake.env.PATH)),
    ]);

    expect(fake.calls().filter((call) => call.args[0] === "auth")).toHaveLength(1);
    expect(fake.calls().filter((call) => call.tokenMatches)).toHaveLength(2);
  });

  it("keeps token caches separate for separate sessions", async () => {
    const dir = useTempDir("tasker-forge-independent-token-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo"), answer]);

    await run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH));
    await run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH));

    expect(fake.calls().filter((call) => call.args[0] === "auth")).toHaveLength(2);
  });

  it("looks up a separate token for each account", async () => {
    const dir = useTempDir("tasker-forge-separate-accounts-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo"), answer, tokenAnswer("other"), answer, answer, answer]);
    const octo = createGhSession("octo");
    const other = createGhSession("other");

    await run(octo, ["repo", "view"], dir, taskerEnv(fake.env.PATH));
    await run(other, ["repo", "view"], dir, taskerEnv(fake.env.PATH));
    await run(octo, ["repo", "view"], dir, taskerEnv(fake.env.PATH));
    await run(other, ["repo", "view"], dir, taskerEnv(fake.env.PATH));

    expect(
      fake
        .calls()
        .filter((call) => call.args[0] === "auth")
        .map((call) => call.args),
    ).toEqual([tokenAnswer("octo").args, tokenAnswer("other").args]);
  });

  it.each([
    ["failed status", "token-looking-output", 1],
    ["empty output", "  \n", 0],
  ])("retries a token lookup after %s", async (_label, stdout, exitCode) => {
    const dir = useTempDir("tasker-forge-token-retry-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo", stdout, exitCode)]);
    const session = createGhSession("octo");
    const env = taskerEnv(fake.env.PATH);

    await failureOf(run(session, ["repo", "view"], dir, env), Error);
    await failureOf(run(session, ["repo", "view"], dir, env), Error);

    expect(fake.calls().filter((call) => call.args[0] === "auth")).toHaveLength(2);
  });

  it("reports the account and external login step when token lookup fails", async () => {
    const dir = useTempDir("tasker-forge-login-guidance-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo", "", 1)]);
    const error = await failureOf(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH)), Error);

    expect(error.message).toContain("octo");
    expect(error.message).toContain("gh auth login");
  });

  it("reports a stopped token lookup without login guidance or captured output", async () => {
    const dir = useTempDir("tasker-forge-token-stopped-");
    const lookup = {
      ...tokenAnswer("octo", "private lookup stdout"),
      stderr: "private lookup stderr",
      killWith: "TERM",
    };
    const fake = forgeGh(dir, forgeToken, [lookup, answer]);
    const error = await failureOf(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH)), Error);

    expect(error.message).toMatch(/signal|stopped|terminated/i);
    expect(error.message).not.toContain("gh auth login");
    expectNoToken(error, "private lookup stdout");
    expectNoToken(error, "private lookup stderr");
    expect(fake.calls().map((call) => call.args)).toEqual([lookup.args]);
  });

  it("rejects nonzero token lookup status even when stdout contains a token", async () => {
    const dir = useTempDir("tasker-forge-token-status-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo", `${forgeToken}\n`, 1), answer]);

    await failureOf(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH)), Error);

    expect(fake.calls().map((call) => call.args)).toEqual([tokenAnswer("octo", `${forgeToken}\n`, 1).args]);
  });
});

describe("forge command results", () => {
  it("accepts empty success output", async () => {
    const dir = useTempDir("tasker-forge-empty-success-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo"), { args: ["repo", "view"], stdout: "" }]);

    await expect(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH))).resolves.toBe("");
  });

  it("removes every token occurrence from successful output", async () => {
    const dir = useTempDir("tasker-forge-token-success-");
    const fake = forgeGh(dir, forgeToken, [
      tokenAnswer("octo"),
      { args: ["repo", "view"], stdout: `${forgeToken} and ${forgeToken}\n` },
    ]);

    const result = await run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH));

    expect(result).toBe("*** and ***\n");
    expect(result).not.toContain(forgeToken);
  });

  it("rejects nonzero status before exposing partial stdout", async () => {
    const dir = useTempDir("tasker-forge-partial-output-");
    const fake = forgeGh(dir, forgeToken, [
      tokenAnswer("octo"),
      { args: ["repo", "view"], stdout: `partial ${forgeToken}`, stderr: "denied", exitCode: 9 },
    ]);

    const error = await failureOf(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH)), Error);

    expect(error.message).toContain("exit code 9");
    expect(error.cause).toBeInstanceOf(Error);
    expectNoToken(error, forgeToken);
  });

  it("trims safe stderr and removes the token from every reachable diagnostic", async () => {
    const dir = useTempDir("tasker-forge-safe-stderr-");
    const fake = forgeGh(dir, forgeToken, [
      tokenAnswer("octo"),
      { args: ["repo", "view"], stdout: forgeToken, stderr: ` \npermission denied ${forgeToken}\n `, exitCode: 2 },
    ]);

    const error = await failureOf(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH)), Error);

    expect((error as Error & { stderr?: string }).stderr).toBe("permission denied ***");
    expectNoToken(error, forgeToken);
  });

  it("gives install guidance when gh cannot start", async () => {
    const dir = useTempDir("tasker-forge-no-gh-");
    const fake = forgeGh(dir, forgeToken, []);
    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], dir, {
        ...taskerEnv(fake.env.PATH),
        TASKER_GH_BIN: join(dir, "missing-gh"),
      }),
      Error,
    );

    expect(error.message).toMatch(/install gh|set TASKER_GH_BIN/);
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toContain("missing-gh");
    expect((error.cause as Error).stack).toContain("missing-gh");
    expect(fake.calls()).toEqual([]);
  });

  it("gives install guidance when a selected bare executable cannot run", async () => {
    const dir = useTempDir("tasker-forge-no-execute-");
    const path = useTempDir("tasker-forge-no-execute-path-");
    const selected = join(path, "selected-gh");
    writeFileSync(selected, "#!/bin/sh\nexit 0\n");
    chmodSync(selected, 0o644);
    const fake = forgeGh(dir, forgeToken, []);
    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], dir, {
        ...taskerEnv(path),
        TASKER_GH_BIN: "selected-gh",
      }),
      Error,
    );

    expect(error.message).toContain("selected-gh");
    expect(error.message).toMatch(/install gh|set TASKER_GH_BIN/);
    expect(fake.calls()).toEqual([]);
  });

  it("keeps an invalid path override readable and does not fall back to gh", async () => {
    const dir = useTempDir("tasker-forge-invalid-override-");
    const fake = forgeGh(dir, forgeToken, []);
    const invalid = join(dir, "invalid-gh");
    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], dir, {
        ...taskerEnv(fake.env.PATH),
        TASKER_GH_BIN: invalid,
      }),
      Error,
    );

    expect(error.message).toContain(invalid);
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as Error).message).toContain(invalid);
    expect((error.cause as Error).stack).toContain(invalid);
    expect(fake.calls()).toEqual([]);
  });

  it("names the missing worktree in its error", async () => {
    const dir = useTempDir("tasker-forge-no-worktree-");
    const missing = join(dir, "missing-worktree");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo")]);

    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], missing, taskerEnv(fake.env.PATH)),
      Error,
    );

    expect(error.message).toContain(missing);
  });

  it("keeps captured output and saved gh logs free of token text", async () => {
    const dir = useTempDir("tasker-forge-quiet-");
    const child = startFixture("forge-gh-quiet.ts", [dir]);

    await expect(child.exited).resolves.toEqual({ code: 0, signal: null });
    expect(child.stdout()).toBe("");
    expect(child.stderr()).toBe("");
    expect(readFileSync(join(dir, "forge-gh.log"), "utf8")).not.toContain(forgeToken);
  });
});
