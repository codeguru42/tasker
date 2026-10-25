import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ChildCommandError,
  childFailureMessage,
  CommandNotFoundError,
  runChild,
  subcommandOf,
} from "../../src/process/run-child.js";
import { failureOf } from "../helpers/errors.js";
import { writeFakeCommand } from "../helpers/fake-commands.js";
import { useTempDir } from "../helpers/temp.js";

let dir: string;
let bin: string;

beforeEach(() => {
  dir = useTempDir("tasker-run-child-");
  bin = join(dir, "bin");
});

describe("runChild", () => {
  it("captures stdout and stderr", async () => {
    writeFakeCommand(bin, "tool", "printf 'out'; printf 'err' >&2");
    const result = await runChild("tool", [], { env: { PATH: bin } });
    expect(result).toEqual({ code: 0, signal: null, stdout: "out", stderr: "err" });
  });

  it("resolves with a non-zero exit code", async () => {
    writeFakeCommand(bin, "tool", "exit 3");
    const result = await runChild("tool", [], { env: { PATH: bin } });
    expect(result.code).toBe(3);
  });

  it("resolves with a null code when a signal stops the child", async () => {
    writeFakeCommand(bin, "tool", "printf 'x'; kill -TERM $$");
    const result = await runChild("tool", [], { env: { PATH: bin } });
    expect(result.code).toBeNull();
    expect(result.signal).toBe("SIGTERM");
  });

  it("runs the child in cwd", async () => {
    writeFakeCommand(bin, "tool", "pwd");
    const cwd = join(dir, "work");
    mkdirSync(cwd);
    const result = await runChild("tool", [], { cwd, env: { PATH: bin } });
    expect(result.stdout.trim()).toBe(realpathSync(cwd));
  });

  it("passes env as it is and does not add process.env", async () => {
    writeFakeCommand(bin, "tool", `printf '%s|%s' "\${FOO-unset}" "\${HOME-unset}"`);
    const result = await runChild("tool", [], { env: { PATH: bin, FOO: "x" } });
    expect(result.stdout).toBe("x|unset");
  });

  it.each([
    ["has no PATH", {}],
    ["has an empty PATH", { PATH: "" }],
  ])("rejects before the child starts when env %s", async (_name, env) => {
    const marker = join(dir, "marker");
    writeFakeCommand(bin, "tool", `touch '${marker}'`);
    const error = await failureOf(runChild("tool", [], { env }), CommandNotFoundError);
    expect(error.message).toBe("tool is not installed: the env has no PATH");
    expect(error.command).toBe("tool");
    expect(error.reason).toBe("no-path");
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects when the command is not on PATH", async () => {
    mkdirSync(bin);
    const error = await failureOf(runChild("tool", [], { env: { PATH: bin } }), CommandNotFoundError);
    expect(error.message).toBe("tool is not installed: tool was not found on PATH");
    expect(error.reason).toBe("not-on-path");
  });

  it("passes the raw error when cwd is a file", async () => {
    writeFakeCommand(bin, "tool", "true");
    const file = join(dir, "file");
    writeFileSync(file, "");
    const error = await runChild("tool", [], { cwd: file, env: { PATH: bin } }).then(
      () => undefined,
      (e: unknown) => e as NodeJS.ErrnoException,
    );
    expect(error).toBeDefined();
    expect(error).not.toBeInstanceOf(CommandNotFoundError);
    expect(error?.code).toBe("ENOTDIR");
  });

  it("reports a missing cwd as not found, so the caller checks the folder", async () => {
    writeFakeCommand(bin, "tool", "true");
    const error = await failureOf(
      runChild("tool", [], { cwd: join(dir, "missing"), env: { PATH: bin } }),
      CommandNotFoundError,
    );
    expect(error.reason).toBe("not-on-path");
  });

  it("rejects with the AbortError when the signal aborts", async () => {
    writeFakeCommand(bin, "tool", "exec sleep 5");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const error = await runChild("tool", [], {
      env: { PATH: [bin, process.env.PATH ?? ""].join(delimiter) },
      signal: controller.signal,
    }).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(error?.name).toBe("AbortError");
  });
});

describe("childFailureMessage", () => {
  it("names the signal when the child has no exit code", () => {
    expect(childFailureMessage("git", "fetch", null, "SIGTERM", "x")).toBe("git fetch was stopped by signal SIGTERM");
  });

  it("gives the exit code and the trimmed stderr", () => {
    expect(childFailureMessage("git", "fetch", 128, null, "  bad\n")).toBe("git fetch failed with exit code 128: bad");
  });

  it("gives no suffix for an empty stderr", () => {
    expect(childFailureMessage("git", "fetch", 1, null, "")).toBe("git fetch failed with exit code 1");
  });
});

describe("ChildCommandError", () => {
  it("is an Error with the fields set", () => {
    const error = new ChildCommandError("boom", "fetch", "out", "err", 2);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("boom");
    expect(error.subcommand).toBe("fetch");
    expect(error.stdout).toBe("out");
    expect(error.stderr).toBe("err");
    expect(error.exitCode).toBe(2);
  });
});

describe("subcommandOf", () => {
  it.each([
    [["issue", "view", "7"], "issue view"],
    [["api", "-X", "PATCH"], "api"],
    [["api"], "api"],
    [["jira", "workitem", "view", "TEST-1"], "jira workitem"],
  ])("gives the subcommand of %j", (args, expected) => {
    expect(subcommandOf(args)).toBe(expected);
  });
});
