import { relative } from "node:path";
import { mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGhSession } from "../../src/github/forge-session.js";
import { failureOf, thrownBy } from "../helpers/errors.js";
import { forgeGh } from "../helpers/forge-gh.js";
import { writeFakeCommand } from "../helpers/fake-commands.js";
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
const run = (
  session: ReturnType<typeof createGhSession>,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) => session.run(args, cwd, env);

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
    ["repo create with push", ["repo", "create", "new-repo", "--push"]],
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

  it.each([undefined, "", "  "])("requires a nonblank TASKER_PATH, got %j", async (path) => {
    const dir = useTempDir("tasker-forge-no-path-");
    const fake = forgeGh(dir, "token", []);
    const error = await failureOf(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(path)), Error);
    expect(error.message).toContain("TASKER_PATH");
    expect(fake.calls()).toEqual([]);
  });

  it.each([
    { TASKER_HOME: "", TASKER_GH_CONFIG_DIR: "" },
    { TASKER_HOME: "  ", TASKER_GH_CONFIG_DIR: undefined },
  ])("requires at least one nonblank authentication location", async (locations) => {
    const dir = useTempDir("tasker-forge-no-auth-location-");
    const fake = forgeGh(dir, "token", []);
    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], dir, { TASKER_PATH: fake.env.PATH, ...locations }),
      Error,
    );
    expect(error.message).toMatch(/TASKER_HOME|TASKER_GH_CONFIG_DIR/);
    expect(fake.calls()).toEqual([]);
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
        "TASKER_HOME",
        "TASKER_GH_CONFIG_DIR",
        "TASKER_GH_BIN",
        "GH_PROMPT_DISABLED",
        "GH_NO_UPDATE_NOTIFIER",
        "NO_COLOR",
        "HOME",
      ],
    );
    useProcessEnv({ PATH: "/ambient/path", HOME: "/ambient/home", GH_TOKEN: "ambient-token" });
    const supplied = taskerEnv(fake.env.PATH, {
      TASKER_GH_TOKEN: undefined,
      TASKER_GH_HOST: undefined,
      TASKER_GH_REPO: undefined,
      GH_TOKEN: "caller-token",
      GH_HOST: "ambient.example",
      GH_REPO: "ambient/repo",
      HOME: "/caller/home",
      TASKER_GH_BIN: fake.env.TASKER_GH_BIN,
    });
    const before = { ...supplied };

    await run(createGhSession("octo"), ["repo", "view"], worktree, supplied);

    const expectedEnv = {
      PATH: fake.env.PATH,
      TASKER_HOME: "/tasker/home",
      TASKER_GH_CONFIG_DIR: "/tasker/gh-config",
      TASKER_GH_BIN: undefined,
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      NO_COLOR: "1",
      HOME: undefined,
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
        ...(kind === "blank" ? { TASKER_GH_BIN: executable } : { TASKER_GH_BIN: executable }),
      }),
    ).resolves.toBe("repository");
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

  it("rejects nonzero token lookup status even when stdout contains a token", async () => {
    const dir = useTempDir("tasker-forge-token-status-");
    const fake = forgeGh(dir, forgeToken, [tokenAnswer("octo", `${forgeToken}\n`, 1), answer]);

    await failureOf(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH)), Error);

    expect(fake.calls().map((call) => call.args)).toEqual([tokenAnswer("octo", `${forgeToken}\n`, 1).args]);
  });
});
