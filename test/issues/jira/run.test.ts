import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AcliBinError,
  AcliError,
  AcliNotInstalledError,
  AcliRefusedError,
  runAcli,
} from "../../../src/issues/jira/run.js";
import { ChildCommandError } from "../../../src/process/run-child.js";
import { failureOf } from "../../helpers/errors.js";
import { fakeAcli, writeFakeAcli } from "../../helpers/fake-acli.js";
import { startFixture } from "../../helpers/processes.js";
import { useTempDir } from "../../helpers/temp.js";

describe("runAcli", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-run-acli-");
  });

  const view = ["jira", "workitem", "view", "TEST-1"];
  const notInstalled = (shown: string) => `${shown} is not installed: install acli, or fix TASKER_ACLI_BIN`;

  it("resolves with the stdout of acli, not trimmed", async () => {
    const fake = fakeAcli(dir, {}, [{ args: view, stdout: '{"key":"TEST-1"}\n' }]);

    const out = await runAcli(view, { env: fake.env });

    expect(out).toBe('{"key":"TEST-1"}\n');
  });

  it("passes the env as it is", async () => {
    const fake = fakeAcli(dir, { FOO: "bar" }, [{ args: view }], { logEnv: ["FOO", "TASKER_ACLI_BIN", "PATH"] });

    await runAcli(view, { env: fake.env });

    expect(fake.calls()).toEqual([
      {
        args: view,
        env: { FOO: "bar", TASKER_ACLI_BIN: fake.env.TASKER_ACLI_BIN, PATH: fake.env.PATH },
      },
    ]);
  });

  describe("the arguments", () => {
    it("rejects an empty list", async () => {
      const fake = fakeAcli(dir, {}, []);

      const error = await failureOf(runAcli([], { env: fake.env }), Error);

      expect(error.message).toBe("runAcli needs an acli subcommand");
      expect(fake.calls()).toEqual([]);
    });

    it("rejects a first argument that starts with a dash", async () => {
      const fake = fakeAcli(dir, {}, []);

      const error = await failureOf(runAcli(["--version"], { env: fake.env }), Error);

      expect(error.message).toBe("runAcli needs the acli subcommand as the first argument");
      expect(fake.calls()).toEqual([]);
    });
  });

  describe("the commands that tasker never runs", () => {
    it.each([
      ["auth", "login"],
      ["auth", "logout"],
      ["auth", "switch"],
      ["jira", "auth", "login"],
      ["jira", "auth", "switch"],
      ["confluence", "auth", "logout"],
      ["admin", "auth", "login", "--site", "x"],
      ["config"],
      ["config", "set", "x"],
    ])("refuses acli %j", async (...args) => {
      const fake = fakeAcli(dir, {}, []);

      const error = await failureOf(runAcli(args, { env: fake.env }), AcliRefusedError);

      expect(error.message).toBe(`tasker never runs acli ${args.join(" ")}: only the user runs it`);
      expect(fake.calls()).toEqual([]);
    });

    it.each([
      ["jira", "auth", "status"],
      ["auth", "status"],
      ["jira", "workitem", "view", "config"],
    ])("does not refuse acli %j", async (...args) => {
      const fake = fakeAcli(dir, {}, [{ args, stdout: "ok" }]);

      await expect(runAcli(args, { env: fake.env })).resolves.toBe("ok");
    });
  });

  describe("TASKER_ACLI_BIN", () => {
    it("runs acli from the PATH when the variable is not set", async () => {
      const fake = fakeAcli(dir, {}, [{ args: view, stdout: "from path" }]);
      const env = { ...fake.env };
      delete env.TASKER_ACLI_BIN;

      await expect(runAcli(view, { env })).resolves.toBe("from path");
    });

    it("runs acli from the PATH when the variable is blank", async () => {
      const fake = fakeAcli(dir, {}, [{ args: view, stdout: "from path" }]);

      await expect(runAcli(view, { env: { ...fake.env, TASKER_ACLI_BIN: "  " } })).resolves.toBe("from path");
    });

    it("runs the file at an absolute path", async () => {
      const fake = fakeAcli(dir, {}, [{ args: view, stdout: "from path" }]);
      const otherBin = join(dir, "other-bin");
      writeFakeAcli(otherBin, join(dir, "other.log"), [{ args: view, stdout: "from other" }], [], "my-acli");

      const out = await runAcli(view, { env: { ...fake.env, TASKER_ACLI_BIN: join(otherBin, "my-acli") } });

      expect(out).toBe("from other");
    });

    it("runs the file at a relative path from the cwd", async () => {
      const fake = fakeAcli(dir, {}, [{ args: view, stdout: "from path" }]);
      const otherBin = join(dir, "other-bin");
      writeFakeAcli(otherBin, join(dir, "other.log"), [{ args: view, stdout: "from other" }], [], "my-acli");
      const value = relative(process.cwd(), join(otherBin, "my-acli"));
      expect(value).toContain("/");

      const out = await runAcli(view, { env: { ...fake.env, TASKER_ACLI_BIN: value } });

      expect(out).toBe("from other");
    });

    it("rejects with AcliBinError for a file that does not exist", async () => {
      const fake = fakeAcli(dir, {}, []);
      const value = join(dir, "missing");

      const error = await failureOf(runAcli(view, { env: { ...fake.env, TASKER_ACLI_BIN: value } }), AcliBinError);

      expect(error.message).toBe(`TASKER_ACLI_BIN is ${value}, but ${value} is not a file that you can run`);
      expect(fake.calls()).toEqual([]);
    });

    it("rejects with AcliBinError for a file that the user cannot run", async () => {
      const fake = fakeAcli(dir, {}, []);
      const value = join(dir, "plain");
      writeFileSync(value, "x");
      chmodSync(value, 0o644);

      await failureOf(runAcli(view, { env: { ...fake.env, TASKER_ACLI_BIN: value } }), AcliBinError);
    });

    it("rejects with AcliBinError for a folder", async () => {
      const fake = fakeAcli(dir, {}, []);
      const value = join(dir, "folder");
      mkdirSync(value);

      await failureOf(runAcli(view, { env: { ...fake.env, TASKER_ACLI_BIN: value } }), AcliBinError);
    });

    it("finds a name with no slash on the PATH", async () => {
      const bin = join(dir, "bin");
      writeFakeAcli(bin, join(dir, "acli.log"), [{ args: view, stdout: "named" }], [], "my-acli");

      await expect(runAcli(view, { env: { PATH: bin, TASKER_ACLI_BIN: "my-acli" } })).resolves.toBe("named");
    });

    it("rejects with AcliNotInstalledError for a name that is not on the PATH", async () => {
      const fake = fakeAcli(dir, {}, []);

      const error = await failureOf(
        runAcli(view, { env: { ...fake.env, TASKER_ACLI_BIN: "no-such-acli" } }),
        AcliNotInstalledError,
      );

      expect(error.message).toBe(notInstalled("no-such-acli"));
    });

    it("rejects with AcliNotInstalledError for an absolute path when the env has no PATH", async () => {
      const fake = fakeAcli(dir, {}, []);
      const path = fake.env.TASKER_ACLI_BIN ?? "";

      const error = await failureOf(runAcli(view, { env: { TASKER_ACLI_BIN: path } }), AcliNotInstalledError);

      expect(error.message).toBe(notInstalled(path));
    });

    it("rejects with AcliNotInstalledError when acli is not on the PATH", async () => {
      const empty = join(dir, "empty");
      mkdirSync(empty);

      const error = await failureOf(runAcli(view, { env: { PATH: empty } }), AcliNotInstalledError);

      expect(error.message).toBe(notInstalled("acli"));
    });
  });

  describe("a failed call", () => {
    it("rejects with an AcliError that holds the output and the exit code", async () => {
      const fake = fakeAcli(dir, {}, [{ args: view, stdout: "o", stderr: "bad\n", exitCode: 1 }]);

      const error = await failureOf(runAcli(view, { env: fake.env }), AcliError);

      expect(error).toBeInstanceOf(ChildCommandError);
      expect(error).toMatchObject({
        subcommand: "jira workitem",
        stdout: "o",
        stderr: "bad\n",
        exitCode: 1,
        message: "acli jira workitem failed with exit code 1: bad",
      });
    });

    it("rejects with a null exit code when a signal stops acli", async () => {
      const fake = fakeAcli(dir, {}, [{ args: view, killWith: "TERM" }]);

      const error = await failureOf(runAcli(view, { env: fake.env }), AcliError);

      expect(error.exitCode).toBeNull();
      expect(error.message).toBe("acli jira workitem was stopped by signal SIGTERM");
    });
  });

  describe("signal", () => {
    it("stops the call when the signal aborts", async () => {
      const fake = fakeAcli(dir, {}, [{ args: view, stdout: "{}", delaySeconds: 5 }]);
      const start = Date.now();

      const error = await failureOf(runAcli(view, { env: fake.env, signal: AbortSignal.timeout(100) }), Error);

      expect(error.name).toBe("AbortError");
      expect(Date.now() - start).toBeLessThan(2000);
    });
  });

  it.each([
    [AcliError, "AcliError"],
    [AcliNotInstalledError, "AcliNotInstalledError"],
    [AcliBinError, "AcliBinError"],
    [AcliRefusedError, "AcliRefusedError"],
  ])("gives the error class %o the name %s", (ErrorClass, name) => {
    const error = ErrorClass === AcliError ? new AcliError("m", "s", "", "", 1) : new ErrorClass("m");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
  });

  it("writes nothing to the terminal, also when acli fails", async () => {
    const child = startFixture("acli-quiet.ts", []);
    await expect(child.exited).resolves.toEqual({ code: 0, signal: null });
    expect(child.stdout()).toBe("");
    expect(child.stderr()).toBe("");
  });
});
