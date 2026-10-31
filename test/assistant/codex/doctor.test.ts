import { describe, expect, it } from "vitest";
import { codexLoginCheck, codexVersionCheck } from "../../../src/assistant/codex/doctor.js";
import type { Check } from "../../../src/doctor/check.js";
import {
  CODEX_LOGIN_STATUS_ARGS,
  CODEX_VERSION_ARGS,
  MEASURED_LOGGED_OUT,
  useFakeCodex,
} from "../../helpers/fake-codex.js";
import { useTempDir } from "../../helpers/temp.js";

const VERSION = "codex-cli 0.166.0";
const NOT_INSTALLED = {
  status: "error",
  detail: "codex is not installed or not on PATH",
  remediation: "Install Codex and put codex on PATH.",
};

function versionCheck(timeoutMs?: number): Check {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return codexVersionCheck(timeoutMs);
}

function loginCheck(timeoutMs?: number): Check {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return codexLoginCheck(timeoutMs);
}

describe("codexVersionCheck", () => {
  it("has the name, required and timeoutMs of the version check", () => {
    const check = versionCheck();

    expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual({
      name: "codex version",
      required: true,
      timeoutMs: 5000,
    });
  });

  it("gives ok with the first line of the version", async () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS, stdout: `${VERSION}\nmore\n` }]);

    expect(await versionCheck().run(fake.env)).toEqual({ status: "ok", detail: VERSION });
    expect(fake.calls().map((call) => call.args)).toEqual([["--version"]]);
  });

  it("gives the fix when codex is not installed", async () => {
    const emptyBin = useTempDir("tasker-empty-bin-");

    expect(await versionCheck().run({ PATH: emptyBin })).toEqual(NOT_INSTALLED);
  });

  it("gives no fix for a non-zero exit", async () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS, stderr: "broken install\nsecond\n", exitCode: 3 }]);

    expect(await versionCheck().run(fake.env)).toEqual({
      status: "error",
      detail: "codex --version exited 3: broken install",
    });
  });

  it("gives the exit code alone when stderr is empty", async () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS, exitCode: 3 }]);

    expect(await versionCheck().run(fake.env)).toEqual({ status: "error", detail: "codex --version exited 3" });
  });

  it("names the signal that stopped codex", async () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS, killWith: "TERM" }]);

    expect(await versionCheck().run(fake.env)).toEqual({
      status: "error",
      detail: "codex --version was killed by SIGTERM",
    });
  });

  it("gives the timeout result when codex is slow", async () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS, stdout: VERSION, delaySeconds: 5 }]);

    expect(await versionCheck(300).run(fake.env)).toEqual({
      status: "error",
      detail: "the check did not finish in 300 ms",
    });
  });

  it("passes only the allowed names to codex", async () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS, stdout: VERSION }], ["CODEX_HOME", "SECRET"]);

    await versionCheck().run({ ...fake.env, CODEX_HOME: "/codex", SECRET: "s" });

    expect(fake.calls().map((call) => call.env)).toEqual([{ CODEX_HOME: "/codex", SECRET: undefined }]);
  });
});

describe("codexLoginCheck", () => {
  it("has the name, required and timeoutMs of the login check", () => {
    const check = loginCheck();

    expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual({
      name: "codex login",
      required: true,
      timeoutMs: 5000,
    });
  });

  it("gives the fix when codex is not installed", async () => {
    const emptyBin = useTempDir("tasker-empty-bin-");

    expect(await loginCheck().run({ PATH: emptyBin })).toEqual(NOT_INSTALLED);
  });

  it("gives the timeout result when codex is slow", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS, delaySeconds: 5 }]);

    expect(await loginCheck(300).run(fake.env)).toEqual({
      status: "error",
      detail: "the check did not finish in 300 ms",
    });
  });

  it("names the signal that stopped codex", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS, killWith: "TERM" }]);

    expect(await loginCheck().run(fake.env)).toEqual({
      status: "error",
      detail: "codex login status was killed by SIGTERM",
    });
  });

  it("gives ok for exit 0", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS }]);

    expect(await loginCheck().run(fake.env)).toEqual({ status: "ok", detail: "codex is logged in" });
    expect(fake.calls().map((call) => call.args)).toEqual([["login", "status"]]);
  });

  it("gives ok for exit 0 also when stderr has the logged-out text", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS, stderr: "Not logged in\n" }]);

    expect(await loginCheck().run(fake.env)).toEqual({ status: "ok", detail: "codex is logged in" });
  });

  it("gives the login fix for the measured logged-out answer", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS, ...MEASURED_LOGGED_OUT }]);

    expect(await loginCheck().run(fake.env)).toEqual({
      status: "error",
      detail: "codex is not logged in",
      remediation: "Run codex login.",
    });
  });

  it("gives the login fix when a line comes before the text", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS, exitCode: 1, stderr: "a warning\nNot logged in\n" }]);

    expect(await loginCheck().run(fake.env)).toEqual({
      status: "error",
      detail: "codex is not logged in",
      remediation: "Run codex login.",
    });
  });

  it("gives no fix when the text is in stdout alone", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS, exitCode: 1, stdout: "Not logged in\n" }]);

    expect(await loginCheck().run(fake.env)).toEqual({ status: "error", detail: "codex login status exited 1" });
  });

  it("gives no fix when CODEX_HOME does not exist", async () => {
    const first = "WARNING: proceeding, even though we could not create PATH aliases: CODEX_HOME points to /missing";
    const fake = useFakeCodex([
      {
        args: CODEX_LOGIN_STATUS_ARGS,
        exitCode: 1,
        stderr: `${first}\nError loading configuration: CODEX_HOME points to /missing\n`,
      },
    ]);

    expect(await loginCheck().run(fake.env)).toEqual({
      status: "error",
      detail: `codex login status exited 1: ${first}`,
    });
  });

  it("gives no fix for exit 1 with other text", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS, exitCode: 1, stderr: "broken\n" }]);

    expect(await loginCheck().run(fake.env)).toEqual({
      status: "error",
      detail: "codex login status exited 1: broken",
    });
  });

  it("gives no fix for another exit code", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS, exitCode: 2, stderr: "Not logged in\n" }]);

    expect(await loginCheck().run(fake.env)).toEqual({
      status: "error",
      detail: "codex login status exited 2: Not logged in",
    });
  });

  it("gives the exit code alone when stderr is empty", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS, exitCode: 2 }]);

    expect(await loginCheck().run(fake.env)).toEqual({ status: "error", detail: "codex login status exited 2" });
  });

  it("passes only the allowed names to codex", async () => {
    const fake = useFakeCodex([{ args: CODEX_LOGIN_STATUS_ARGS }], ["CODEX_HOME", "SECRET"]);

    await loginCheck().run({ ...fake.env, CODEX_HOME: "/codex", SECRET: "s" });

    expect(fake.calls().map((call) => call.env)).toEqual([{ CODEX_HOME: "/codex", SECRET: undefined }]);
  });
});
