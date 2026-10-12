import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failureOf, fakeGh, ghTokenAnswer, makeTempDir } from "../../helpers.js";

describe("authStatus", () => {
  // The module loads again before each test, so that each test starts with an empty token cache.
  // Never import auth.ts or run.ts at the top of this file: a second copy would have other error classes.
  let auth: typeof import("../../../src/issues/github/auth.js");
  let dir: string;

  beforeEach(async () => {
    dir = makeTempDir("tasker-auth-status-");
    vi.resetModules();
    auth = await import("../../../src/issues/github/auth.js");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("is ok when the login of the token is the account, with any ASCII case", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: ["api", "user", "--jq", ".login"], stdout: "Octo\n" },
    ]);
    expect(await auth.authStatus("octo", fake.env)).toEqual({
      ok: true,
      login: "Octo",
      detail: "gh is logged in as Octo",
    });
  });

  const loginArgs = ["api", "user", "--jq", ".login"];
  const tokenArgs = ["auth", "token", "--hostname", "github.com", "--user", "octo"];

  it("is not ok when the token call fails, and gives the message of the login error", async () => {
    const fake = fakeGh(dir, {}, [
      { args: tokenArgs, stderr: "no oauth token found\n", exitCode: 1 },
    ]);
    expect(await auth.authStatus("octo", fake.env)).toEqual({
      ok: false,
      detail:
        "gh has no login for the account octo on github.com: run `gh auth login --hostname github.com` and log in as octo. gh said: no oauth token found",
    });
    expect(fake.calls().map((call) => call.args)).toEqual([tokenArgs]);
  });

  it("hides the token in the detail of a 401", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_secret"),
      { args: loginArgs, stderr: "gh: Bad credentials (HTTP 401) gho_secret\n", exitCode: 1 },
    ]);
    const status = await auth.authStatus("octo", fake.env);
    expect(status).toEqual({
      ok: false,
      detail: "gh api user failed with exit code 1: gh: Bad credentials (HTTP 401) ***",
    });
    expect(JSON.stringify(status)).not.toContain("gho_secret");
    expect(fake.calls().map((call) => call.args)).toEqual([tokenArgs, loginArgs]);
  });

  it("is not ok when the token is for another login", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: loginArgs, stdout: "hubot\n" },
    ]);
    expect(await auth.authStatus("octo", fake.env)).toEqual({
      ok: false,
      login: "hubot",
      detail: "the token of the account octo is for the login hubot",
    });
    expect(fake.calls().map((call) => call.args)).toEqual([tokenArgs, loginArgs]);
  });

  it("is not ok when gh gives no login", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: loginArgs, stdout: "\n" },
    ]);
    expect(await auth.authStatus("octo", fake.env)).toEqual({
      ok: false,
      detail: "gh api user gave no login for the account octo",
    });
    expect(fake.calls().map((call) => call.args)).toEqual([tokenArgs, loginArgs]);
  });

  it("is not ok when gh is not installed", async () => {
    const status = await auth.authStatus("octo", { PATH: dir });
    expect(status.ok).toBe(false);
    expect(status.detail).toContain("gh is not installed");
  });

  it("throws an AbortError again", async () => {
    const fake = fakeGh(dir, {}, [
      ghTokenAnswer("octo", "gho_test"),
      { args: loginArgs, stdout: "octo\n", delaySeconds: 5 },
    ]);
    const start = Date.now();
    const error = await failureOf(
      auth.authStatus("octo", fake.env, { signal: AbortSignal.timeout(100) }),
      Error,
    );
    expect(error.name).toBe("AbortError");
    expect(Date.now() - start).toBeLessThan(2000);
    expect(fake.calls().map((call) => call.args)).toEqual([tokenArgs, loginArgs]);
  });
});
