import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandFailureMessage, commandLogTail } from "../../src/phases/command-step.js";
import { useTempDir } from "../helpers/temp.js";

describe("commandFailureMessage", () => {
  const failed = { status: "failed", index: 2, command: "npm ci", timedOut: false } as const;

  it("names the exit code", () => {
    expect(commandFailureMessage("bootstrap", { ...failed, exitCode: 3 }, "/logs/bootstrap.log", 10)).toBe(
      "bootstrap command 2 failed: npm ci: exit code 3. The log is /logs/bootstrap.log.",
    );
  });

  it("names the timeout in minutes", () => {
    expect(commandFailureMessage("bootstrap", { ...failed, signal: "SIGTERM", timedOut: true }, "/l.log", 10)).toBe(
      "bootstrap command 2 failed: npm ci: timed out after 10 min. The log is /l.log.",
    );
  });

  it("names a command that could not start", () => {
    expect(commandFailureMessage("verify", { ...failed, timedOut: false, error: "spawn ENOENT" }, "/l.log", 10)).toBe(
      "verify command 2 failed: npm ci: could not start: spawn ENOENT. The log is /l.log.",
    );
  });

  it("names the start error before the timeout", () => {
    expect(commandFailureMessage("verify", { ...failed, timedOut: true, error: "spawn ENOENT" }, "/l.log", 10)).toBe(
      "verify command 2 failed: npm ci: could not start: spawn ENOENT. The log is /l.log.",
    );
  });

  it("names the signal when no timeout ended the command", () => {
    expect(commandFailureMessage("bootstrap", { ...failed, signal: "SIGKILL" }, "/l.log", 10)).toBe(
      "bootstrap command 2 failed: npm ci: stopped by signal SIGKILL. The log is /l.log.",
    );
  });
});

describe("commandLogTail", () => {
  function logWith(content: string): string {
    const path = join(useTempDir("tasker-tail-"), "bootstrap.log");
    writeFileSync(path, content);
    return path;
  }

  const numbers = (count: number) => Array.from({ length: count }, (_, i) => `${i + 1}\n`);

  it("gives the last 20 lines of a long log", () => {
    const log = logWith(numbers(30).join(""));
    expect(commandLogTail(log, 20)).toBe(
      `the last 20 lines of the log:\n${numbers(30).slice(10).join("")}`,
    );
  });

  it("gives all the lines of a short log with the real count", () => {
    expect(commandLogTail(logWith("1\n2\n3\n"), 20)).toBe("the last 3 lines of the log:\n1\n2\n3\n");
  });

  it("counts a last line with no line end", () => {
    expect(commandLogTail(logWith("1\n2"), 20)).toBe("the last 2 lines of the log:\n1\n2\n");
  });

  it("says that the log is missing", () => {
    const log = join(useTempDir("tasker-tail-"), "none.log");
    expect(commandLogTail(log, 20)).toBe(`the log is missing: ${log}\n`);
  });

  it("gives the error code of a log that cannot be read", () => {
    const log = join(useTempDir("tasker-tail-"), "folder");
    mkdirSync(log);
    expect(commandLogTail(log, 20)).toBe(`cannot read the log ${log}: EISDIR\n`);
  });
});
