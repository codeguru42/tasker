import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failureOf } from "../../helpers/errors.js";
import { fakeGh, ghTokenAnswer } from "../../helpers/fake-gh.js";
import { writeFakeCommand } from "../../helpers/fake-commands.js";
import { startFixture } from "../../helpers/processes.js";
import { useProcessEnv, useTempDir } from "../../helpers/temp.js";

// Fails when token is in the error: its text, its stack, any own property, or a cause.
function expectNoToken(error: Error, token: string): void {
  expect(String(error)).not.toContain(token);
  expect(error.stack ?? "").not.toContain(token);
  expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(token);
  expect(error.cause).toBeUndefined();
}

describe("runGh", () => {
  // The module loads again before each test, so that each test starts with an empty token cache.
  // Never import run.ts at the top of this file: a second copy would have other error classes.
  let gh: typeof import("../../../src/issues/github/run.js");
  let programFileError: typeof import("../../../src/process/resolve-program.js").ProgramFileError;
  let dir: string;

  beforeEach(async () => {
    dir = useTempDir("tasker-run-gh-");
    vi.resetModules();
    programFileError = (await import("../../../src/process/resolve-program.js")).ProgramFileError;
    gh = await import("../../../src/issues/github/run.js");
  });

  const tokenArgs = (account: string) => ["auth", "token", "--hostname", "github.com", "--user", account];
  const run = (args: readonly string[], env: NodeJS.ProcessEnv) => gh.runGh(args, { account: "octo", env });
  const readVersion = (env: NodeJS.ProcessEnv) => gh.readGhVersion(env);

  it.each([undefined, "", "  "])("uses gh on the explicit child PATH when TASKER_GH_BIN is %j", async (override) => {
    const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: ["api", "user"], stdout: "ok" }]);
    const env = { ...fake.env, TASKER_GH_BIN: override };

    expect(await run(["api", "user"], env)).toBe("ok");
    expect(fake.calls().map((call) => call.args)).toEqual([tokenArgs("octo"), ["api", "user"]]);
  });

  it("uses a bare override on the explicit child PATH despite process PATH", async () => {
    const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: ["api", "user"], stdout: "ok" }]);
    const lookup = useTempDir("tasker-gh-lookup-");
    writeFakeCommand(lookup, "selected-gh", `exec "${fake.env.TASKER_GH_BIN!}" "$@"`);
    const env = { ...fake.env, PATH: lookup, TASKER_GH_BIN: "selected-gh" };
    const otherPath = useTempDir("tasker-gh-process-path-");
    useProcessEnv({ PATH: otherPath });

    expect(await run(["api", "user"], env)).toBe("ok");
    expect(fake.calls().map((call) => call.args)).toEqual([tokenArgs("octo"), ["api", "user"]]);
  });

  it.each(["absolute", "relative"] as const)("uses a %s executable outside the child PATH", async (kind) => {
    const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: ["api", "user"], stdout: "ok" }]);
    const value = kind === "absolute" ? fake.env.TASKER_GH_BIN! : relative(process.cwd(), fake.env.TASKER_GH_BIN!);
    const env = { ...fake.env, PATH: useTempDir("tasker-gh-empty-path-"), TASKER_GH_BIN: value };

    expect(await run(["api", "user"], env)).toBe("ok");
    expect(fake.calls().map((call) => call.args)).toEqual([tokenArgs("octo"), ["api", "user"]]);
  });

  it.each(["missing", "not executable", "directory"] as const)(
    "rejects an invalid %s override before starting gh",
    async (kind) => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: ["api", "user"] }]);
      const invalidDir = useTempDir("tasker-gh-invalid-");
      const value =
        kind === "missing"
          ? join(invalidDir, "missing")
          : kind === "not executable"
            ? join(invalidDir, "plain")
            : invalidDir;
      if (kind === "not executable") {
        writeFileSync(value, "plain");
        chmodSync(value, 0o644);
      }
      const env = { ...fake.env, PATH: useTempDir("tasker-gh-invalid-path-"), TASKER_GH_BIN: value };

      const error = await failureOf(run(["api", "user"], env), programFileError);

      expect(error).toMatchObject({
        name: "ProgramFileError",
        message: `TASKER_GH_BIN is ${value}, but ${value} is not a file that you can run`,
        variable: "TASKER_GH_BIN",
        value,
      });
      expect(fake.calls()).toEqual([]);
    },
  );

  it("uses the selected executable for a version read", async () => {
    const fake = fakeGh(dir, {}, [{ args: ["--version"], stdout: "selected version\n" }]);
    const env = { ...fake.env, PATH: useTempDir("tasker-gh-version-path-"), TASKER_GH_BIN: fake.env.TASKER_GH_BIN };

    expect(await readVersion(env)).toBe("selected version\n");
    expect(fake.calls()).toEqual([{ args: ["--version"], ghToken: undefined, env: {} }]);
  });

  it("resolves with the stdout of gh, not trimmed", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: ["api", "user"], stdout: '{"login":"octo"}\n' },
    ]);
    const out = await gh.runGh(["api", "user"], { account: "octo", env: fake.env });
    expect(out).toBe('{"login":"octo"}\n');
  });

  it("reads the token before the call", async () => {
    const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: ["api", "user"], stdout: "{}" }]);
    await gh.runGh(["api", "user"], { account: "octo", env: fake.env });
    expect(fake.calls()).toEqual([
      { args: tokenArgs("octo"), ghToken: undefined, env: {} },
      { args: ["api", "user"], ghToken: "gho_test", env: {} },
    ]);
  });

  it("reads the token one time for two calls of one account", async () => {
    const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: ["api", "user"], stdout: "{}" }]);
    const options = { account: "octo", env: fake.env };
    await gh.runGh(["api", "user"], options);
    await gh.runGh(["api", "user"], options);
    const tokenCalls = fake.calls().filter((call) => call.args[0] === "auth");
    expect(tokenCalls).toHaveLength(1);
    expect(fake.calls()).toHaveLength(3);
  });

  it("reads the token one time for two calls at the same time", async () => {
    const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: ["api", "user"], stdout: "{}" }]);
    const options = { account: "octo", env: fake.env };
    await Promise.all([gh.runGh(["api", "user"], options), gh.runGh(["api", "user"], options)]);
    const tokenCalls = fake.calls().filter((call) => call.args[0] === "auth");
    expect(tokenCalls).toHaveLength(1);
    expect(fake.calls()).toHaveLength(3);
  });

  it("reads one token for each account and sends each call its own token", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_octo"),
      ghTokenAnswer("ghost", "gho_ghost"),
      { args: ["api", "user"], stdout: "{}" },
    ]);
    await gh.runGh(["api", "user"], { account: "octo", env: fake.env });
    await gh.runGh(["api", "user"], { account: "ghost", env: fake.env });
    expect(fake.calls()).toEqual([
      { args: tokenArgs("octo"), ghToken: undefined, env: {} },
      { args: ["api", "user"], ghToken: "gho_octo", env: {} },
      { args: tokenArgs("ghost"), ghToken: undefined, env: {} },
      { args: ["api", "user"], ghToken: "gho_ghost", env: {} },
    ]);
  });

  it("removes and sets the names of the environment, and passes the others", async () => {
    const logEnv = [
      "GITHUB_TOKEN",
      "GH_ENTERPRISE_TOKEN",
      "GITHUB_ENTERPRISE_TOKEN",
      "GH_HOST",
      "GH_REPO",
      "GH_PROMPT_DISABLED",
      "GH_NO_UPDATE_NOTIFIER",
      "NO_COLOR",
      "GH_CONFIG_DIR",
      "HOME",
    ];
    const fake = fakeGh(
      dir,
      {
        GH_TOKEN: "junk-gh-token",
        GITHUB_TOKEN: "junk-github-token",
        GH_ENTERPRISE_TOKEN: "junk-enterprise",
        GITHUB_ENTERPRISE_TOKEN: "junk-github-enterprise",
        GH_HOST: "junk.example.com",
        GH_REPO: "junk/repo",
        GH_CONFIG_DIR: `${dir}/gh-config`,
        HOME: dir,
        NO_COLOR: "0",
      },
      [ghTokenAnswer("octo", "gho_test"), { args: ["api", "user"], stdout: "{}" }],
      { logEnv },
    );
    await gh.runGh(["api", "user"], { account: "octo", env: fake.env });
    const unset = {
      GITHUB_TOKEN: undefined,
      GH_ENTERPRISE_TOKEN: undefined,
      GITHUB_ENTERPRISE_TOKEN: undefined,
      GH_HOST: undefined,
      GH_REPO: undefined,
    };
    const expected = {
      ...unset,
      GH_PROMPT_DISABLED: "1",
      GH_NO_UPDATE_NOTIFIER: "1",
      NO_COLOR: "1",
      GH_CONFIG_DIR: `${dir}/gh-config`,
      HOME: dir,
    };
    const [tokenCall, mainCall] = fake.calls();
    expect(tokenCall).toEqual({ args: tokenArgs("octo"), ghToken: undefined, env: expected });
    expect(mainCall).toEqual({ args: ["api", "user"], ghToken: "gho_test", env: expected });
  });

  it("writes nothing to the terminal, also when gh fails", async () => {
    const child = startFixture("gh-quiet.ts", []);
    await expect(child.exited).resolves.toEqual({ code: 0, signal: null });
    expect(child.stdout()).toBe("");
    expect(child.stderr()).toBe("");
  });

  describe("signal", () => {
    it("stops the main call when the signal aborts", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: ["api", "user"], stdout: "{}", delaySeconds: 5 },
      ]);
      const start = Date.now();
      const error = await failureOf(
        gh.runGh(["api", "user"], {
          account: "octo",
          env: fake.env,
          signal: AbortSignal.timeout(100),
        }),
        Error,
      );
      expect(error.name).toBe("AbortError");
      expect(Date.now() - start).toBeLessThan(2000);
      expect(fake.calls()).toEqual([
        { args: tokenArgs("octo"), ghToken: undefined, env: {} },
        { args: ["api", "user"], ghToken: "gho_test", env: {} },
      ]);
    });
  });

  describe("signal and the shared token read", () => {
    const apiUser = ["api", "user"];

    it("keeps the token read for a caller that still waits", async () => {
      const fake = fakeGh(dir, {}, [
        { ...ghTokenAnswer("octo", "gho_test"), delaySeconds: 1 },
        { args: apiUser, stdout: "{}" },
      ]);
      const start = Date.now();
      const a = failureOf(
        gh.runGh(apiUser, { account: "octo", env: fake.env, signal: AbortSignal.timeout(100) }),
        Error,
      );
      const b = gh.runGh(apiUser, { account: "octo", env: fake.env });
      const error = await a;
      expect(error.name).toBe("AbortError");
      expect(Date.now() - start).toBeLessThan(800);
      expect(await b).toBe("{}");
      await gh.runGh(apiUser, { account: "octo", env: fake.env });
      expect(fake.calls().map((call) => call.args)).toEqual([tokenArgs("octo"), apiUser, apiUser]);
    });

    it("stops the token read when every caller stopped, and the next call reads again", async () => {
      const fake = fakeGh(dir, {}, [
        { ...ghTokenAnswer("octo", "gho_old"), delaySeconds: 5 },
        { args: apiUser, stdout: "{}" },
      ]);
      const start = Date.now();
      const a = failureOf(
        gh.runGh(apiUser, { account: "octo", env: fake.env, signal: AbortSignal.timeout(100) }),
        Error,
      );
      const b = failureOf(
        gh.runGh(apiUser, { account: "octo", env: fake.env, signal: AbortSignal.timeout(200) }),
        Error,
      );
      const [errorA, errorB] = await Promise.all([a, b]);
      expect(errorA.name).toBe("AbortError");
      expect(errorB.name).toBe("AbortError");
      expect(Date.now() - start).toBeLessThan(1500);
      fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_new"), { args: apiUser, stdout: "{}" }]);
      expect(await gh.runGh(apiUser, { account: "octo", env: fake.env })).toBe("{}");
      const calls = fake.calls();
      expect(calls.filter((call) => call.args[0] === "auth")).toHaveLength(2);
      expect(calls[calls.length - 1]).toEqual({ args: apiUser, ghToken: "gho_new", env: {} });
    });

    it("rejects at once for a signal that already aborted, and starts no gh", async () => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: apiUser }]);
      const start = Date.now();
      const error = await failureOf(
        gh.runGh(apiUser, { account: "octo", env: fake.env, signal: AbortSignal.abort() }),
        Error,
      );
      expect(error.name).toBe("AbortError");
      expect(Date.now() - start).toBeLessThan(500);
      expect(fake.calls()).toEqual([]);
    });
  });

  describe("readGhVersion", () => {
    it("resolves with the stdout of gh --version and sends no token", async () => {
      const fake = fakeGh(dir, {}, [{ args: ["--version"], stdout: "gh version 2.101.0 (2026-09-15)\n" }]);
      expect(await gh.readGhVersion(fake.env)).toBe("gh version 2.101.0 (2026-09-15)\n");
      expect(fake.calls()).toEqual([{ args: ["--version"], ghToken: undefined, env: {} }]);
    });

    it("rejects with a GhNotInstalledError when PATH holds no gh", async () => {
      const empty = `${dir}/empty`;
      mkdirSync(empty);
      const error = await failureOf(gh.readGhVersion({ PATH: empty }), gh.GhNotInstalledError);
      expect(error.message).toContain("gh is not installed");
    });

    it("rejects with an AbortError when the signal aborts", async () => {
      const fake = fakeGh(dir, {}, [{ args: ["--version"], stdout: "x", delaySeconds: 5 }]);
      const start = Date.now();
      const error = await failureOf(gh.readGhVersion(fake.env, { signal: AbortSignal.timeout(100) }), Error);
      expect(error.name).toBe("AbortError");
      expect(Date.now() - start).toBeLessThan(2000);
      expect(fake.calls()).toEqual([{ args: ["--version"], ghToken: undefined, env: {} }]);
    });
  });

  describe("errors", () => {
    const token = "gho_secret";
    const apiUser = ["api", "user"];

    it("rejects a failing call with a GhError", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: ["issue", "view", "7"], stderr: "boom\n", exitCode: 1 },
      ]);
      const error = await failureOf(gh.runGh(["issue", "view", "7"], { account: "octo", env: fake.env }), gh.GhError);
      expect(error.message).toBe("gh issue view failed with exit code 1: boom");
      expect(error.subcommand).toBe("issue view");
      expect(error.stderr).toBe("boom\n");
      expect(error.exitCode).toBe(1);
    });

    it.each([
      [["api", "graphql", "-f", "query=x"], "api graphql"],
      [["api", "-X", "PATCH", "repos/a/b"], "api"],
      [["api", "user"], "api user"],
      [["issue", "view", "7"], "issue view"],
    ])("names the subcommand of %j as %s", async (args, subcommand) => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args, exitCode: 1 }]);
      const error = await failureOf(gh.runGh(args, { account: "octo", env: fake.env }), gh.GhError);
      expect(error.subcommand).toBe(subcommand);
    });

    it("rejects with a GhNotInstalledError when PATH holds no gh", async () => {
      const empty = `${dir}/empty`;
      mkdirSync(empty);
      const error = await failureOf(
        gh.runGh(apiUser, { account: "octo", env: { PATH: empty } }),
        gh.GhNotInstalledError,
      );
      expect(error.message).toContain("gh is not installed");
    });

    it("rejects with a GhNotInstalledError when the env has no PATH", async () => {
      const fake = fakeGh(dir, {}, []);
      const error = await failureOf(gh.runGh(apiUser, { account: "octo", env: {} }), gh.GhNotInstalledError);
      expect(error.message).toContain("gh is not installed");
      expect(fake.calls()).toEqual([]);
    });

    it("rejects with a GhLoginError when the token call fails", async () => {
      const fake = fakeGh(dir, {}, [
        {
          args: ["auth", "token", "--hostname", "github.com", "--user", "ghost"],
          stderr: "no oauth token found for github.com account ghost\n",
          exitCode: 1,
        },
      ]);
      const error = await failureOf(gh.runGh(apiUser, { account: "ghost", env: fake.env }), gh.GhLoginError);
      expect(error.message).toContain("run `gh auth login --hostname github.com` and log in as ghost");
      expect(error.message).toContain("no oauth token found for github.com account ghost");
      expect(error.account).toBe("ghost");
      expect(fake.calls()).toHaveLength(1);
    });

    it("rejects with a GhLoginError when the token is empty", async () => {
      const fake = fakeGh(dir, {}, [
        { args: ["auth", "token", "--hostname", "github.com", "--user", "octo"], stdout: "\n" },
      ]);
      await failureOf(gh.runGh(apiUser, { account: "octo", env: fake.env }), gh.GhLoginError);
    });

    it("does not keep a failed token read", async () => {
      const failing = fakeGh(dir, {}, [
        {
          args: ["auth", "token", "--hostname", "github.com", "--user", "octo"],
          stderr: "no token\n",
          exitCode: 1,
        },
      ]);
      await failureOf(gh.runGh(apiUser, { account: "octo", env: failing.env }), gh.GhLoginError);
      const working = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: apiUser, stdout: "{}" }]);
      await expect(gh.runGh(apiUser, { account: "octo", env: working.env })).resolves.toBe("{}");
    });

    it("replaces the token in the error of a main call that exits with 1", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", token),
        { args: apiUser, stdout: `out ${token}`, stderr: `err ${token}\n`, exitCode: 1 },
      ]);
      const error = await failureOf(gh.runGh(apiUser, { account: "octo", env: fake.env }), gh.GhError);
      expectNoToken(error, token);
      expect(error.message).toContain("***");
      expect(error.stderr).toContain("***");
      expect(error.stdout).toContain("***");
    });

    it("keeps the stdout of the token call out of a GhLoginError", async () => {
      const fake = fakeGh(dir, {}, [
        {
          args: ["auth", "token", "--hostname", "github.com", "--user", "octo"],
          stdout: `${token}\n`,
          exitCode: 1,
        },
      ]);
      const error = await failureOf(gh.runGh(apiUser, { account: "octo", env: fake.env }), gh.GhLoginError);
      expectNoToken(error, token);
    });

    it("drops the stdout of a token call that a signal stops", async () => {
      const fake = fakeGh(dir, {}, [
        {
          args: ["auth", "token", "--hostname", "github.com", "--user", "octo"],
          stdout: `${token}\n`,
          killWith: "TERM",
        },
      ]);
      const error = await failureOf(gh.runGh(apiUser, { account: "octo", env: fake.env }), gh.GhError);
      expect(error.message).toBe("gh auth token was stopped by signal SIGTERM");
      expect(error.stdout).toBe("");
      expectNoToken(error, token);
    });

    it("replaces the token in the error of a main call that a signal stops", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", token),
        { args: apiUser, stdout: `out ${token}`, stderr: `err ${token}`, killWith: "TERM" },
      ]);
      const error = await failureOf(gh.runGh(apiUser, { account: "octo", env: fake.env }), gh.GhError);
      expectNoToken(error, token);
    });
  });
});
