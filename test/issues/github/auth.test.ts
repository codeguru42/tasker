import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGh, ghTokenAnswer, makeTempDir } from "../../helpers.js";

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
});
