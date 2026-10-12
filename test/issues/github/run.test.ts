import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGh, ghTokenAnswer, makeTempDir, repoRoot } from "../../helpers.js";

describe("runGh", () => {
  // The module loads again before each test, so that each test starts with an empty token cache.
  // Never import run.ts at the top of this file: a second copy would have other error classes.
  let gh: typeof import("../../../src/issues/github/run.js");
  let dir: string;

  beforeEach(async () => {
    dir = makeTempDir("tasker-run-gh-");
    vi.resetModules();
    gh = await import("../../../src/issues/github/run.js");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const tokenArgs = (account: string) => [
    "auth",
    "token",
    "--hostname",
    "github.com",
    "--user",
    account,
  ];

  it("resolves with the stdout of gh, not trimmed", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: ["api", "user"], stdout: '{"login":"octo"}\n' },
    ]);
    const out = await gh.runGh(["api", "user"], { account: "octo", env: fake.env });
    expect(out).toBe('{"login":"octo"}\n');
  });

  it("reads the token before the call", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: ["api", "user"], stdout: "{}" },
    ]);
    await gh.runGh(["api", "user"], { account: "octo", env: fake.env });
    expect(fake.calls()).toEqual([
      { args: tokenArgs("octo"), ghToken: undefined, env: {} },
      { args: ["api", "user"], ghToken: "gho_test", env: {} },
    ]);
  });

  it("reads the token one time for two calls of one account", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: ["api", "user"], stdout: "{}" },
    ]);
    const options = { account: "octo", env: fake.env };
    await gh.runGh(["api", "user"], options);
    await gh.runGh(["api", "user"], options);
    const tokenCalls = fake.calls().filter((call) => call.args[0] === "auth");
    expect(tokenCalls).toHaveLength(1);
    expect(fake.calls()).toHaveLength(3);
  });

  it("reads the token one time for two calls at the same time", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: ["api", "user"], stdout: "{}" },
    ]);
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
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", "test/fixtures/gh-quiet.ts"], {
          cwd: repoRoot,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      },
    );
    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});
