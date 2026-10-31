import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODEX_LOGIN_STATUS_ARGS, CODEX_VERSION_ARGS, MEASURED_LOGGED_OUT, useFakeCodex } from "./fake-codex.js";

function runCodex(env: NodeJS.ProcessEnv, args: readonly string[]) {
  return spawnSync(join(env.PATH ?? "", "codex"), [...args], { env, encoding: "utf8" });
}

describe("useFakeCodex", () => {
  it("gives the stdout, stderr and exit code of the answer", () => {
    const fake = useFakeCodex([
      { args: CODEX_VERSION_ARGS, stdout: "codex-cli 0.166.0\n" },
      { args: CODEX_LOGIN_STATUS_ARGS, ...MEASURED_LOGGED_OUT },
    ]);

    const version = runCodex(fake.env, CODEX_VERSION_ARGS);
    const login = runCodex(fake.env, CODEX_LOGIN_STATUS_ARGS);

    expect([version.stdout, version.stderr, version.status]).toEqual(["codex-cli 0.166.0\n", "", 0]);
    expect([login.stdout, login.stderr, login.status]).toEqual(["", "Not logged in\n", 1]);
  });

  it("logs each call", () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS }, { args: CODEX_LOGIN_STATUS_ARGS }]);

    runCodex(fake.env, CODEX_VERSION_ARGS);
    runCodex(fake.env, CODEX_LOGIN_STATUS_ARGS);

    expect(fake.calls()).toEqual([
      { args: ["--version"], env: {} },
      { args: ["login", "status"], env: {} },
    ]);
  });

  it("logs the env names of logEnv", () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS }], ["CODEX_HOME", "SECRET"]);

    runCodex({ ...fake.env, CODEX_HOME: "/codex" }, CODEX_VERSION_ARGS);

    expect(fake.calls()).toEqual([{ args: ["--version"], env: { CODEX_HOME: "/codex", SECRET: undefined } }]);
  });

  it("has the bin folder as the only PATH folder", () => {
    const fake = useFakeCodex([]);

    expect(fake.env.PATH.endsWith("/bin")).toBe(true);
    expect(fake.env.PATH).not.toContain(":");
  });
});
