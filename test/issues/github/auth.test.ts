import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
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

  const loginArgs = ["api", "user", "--jq", ".login"];
  const tokenArgs = ["auth", "token", "--hostname", "github.com", "--user", "octo"];
  const token = ghTokenAnswer("octo", "gho_test");

  const rows: {
    name: string;
    answers: Parameters<typeof fakeGh>[2];
    notInstalled?: boolean;
    result: Record<string, unknown>;
    calls: string[][];
  }[] = [
    {
      name: "is ok when the login of the token is the account, with any ASCII case",
      answers: [token, { args: loginArgs, stdout: "Octo\n" }],
      result: { ok: true, login: "Octo", detail: "gh is logged in as Octo", needsLogin: false },
      calls: [tokenArgs, loginArgs],
    },
    {
      name: "needs a login when the token call fails",
      answers: [{ args: tokenArgs, stderr: "no oauth token found\n", exitCode: 1 }],
      result: {
        ok: false,
        detail:
          "gh has no login for the account octo on github.com: run `gh auth login --hostname github.com` and log in as octo. gh said: no oauth token found",
        needsLogin: true,
      },
      calls: [tokenArgs],
    },
    {
      name: "needs a login when gh gives no login",
      answers: [token, { args: loginArgs, stdout: "\n" }],
      result: {
        ok: false,
        detail: "gh api user gave no login for the account octo",
        needsLogin: true,
      },
      calls: [tokenArgs, loginArgs],
    },
    {
      name: "needs a login when the token is for another login",
      answers: [token, { args: loginArgs, stdout: "hubot\n" }],
      result: {
        ok: false,
        login: "hubot",
        detail: "the token of the account octo is for the login hubot",
        needsLogin: true,
      },
      calls: [tokenArgs, loginArgs],
    },
    {
      name: "needs a login for a 401",
      answers: [token, { args: loginArgs, stderr: "gh: Bad credentials (HTTP 401)\n", exitCode: 1 }],
      result: {
        ok: false,
        detail: "gh api user failed with exit code 1: gh: Bad credentials (HTTP 401)",
        needsLogin: true,
      },
      calls: [tokenArgs, loginArgs],
    },
    {
      name: "needs no login for a 502",
      answers: [token, { args: loginArgs, stderr: "gh: Server Error (HTTP 502)\n", exitCode: 1 }],
      result: {
        ok: false,
        detail: "gh api user failed with exit code 1: gh: Server Error (HTTP 502)",
        needsLogin: false,
      },
      calls: [tokenArgs, loginArgs],
    },
    {
      name: "needs no login when a signal stops gh",
      answers: [token, { args: loginArgs, killWith: "TERM" }],
      result: {
        ok: false,
        detail: "gh api user was stopped by signal SIGTERM",
        needsLogin: false,
      },
      calls: [tokenArgs, loginArgs],
    },
    {
      name: "needs no login when gh is not installed",
      answers: [],
      notInstalled: true,
      result: {
        ok: false,
        detail: "gh is not installed: gh was not found on PATH",
        needsLogin: false,
      },
      calls: [],
    },
  ];

  it.each(rows)("$name", async (row) => {
    const fake = fakeGh(dir, {}, row.answers);
    let env = fake.env;
    if (row.notInstalled) {
      const empty = join(dir, "empty");
      mkdirSync(empty);
      env = { PATH: empty };
    }
    expect(await auth.authStatus("octo", env)).toStrictEqual(row.result);
    expect(fake.calls().map((call) => call.args)).toEqual(row.calls);
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
      needsLogin: true,
    });
    expect(JSON.stringify(status)).not.toContain("gho_secret");
    expect(fake.calls().map((call) => call.args)).toEqual([tokenArgs, loginArgs]);
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
