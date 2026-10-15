import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commandFailureMessage, NO_OUTPUT_LINE, readCommandLog, textLines } from "../../src/phases/command-step.js";
import { useTempDir, useTempFile } from "../helpers/temp.js";

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

describe("readCommandLog", () => {
  const numbers = (count: number) => Array.from({ length: count }, (_, i) => `${i + 1}\n`);

  it("gives the last 20 lines of a long log", () => {
    const log = useTempFile("tasker-read-log-", "verify.log", numbers(30).join(""));
    expect(readCommandLog(log, 20).tail).toBe(`the last 20 lines of the log:\n${numbers(30).slice(10).join("")}`);
  });

  it("gives all the lines of a short log with the real count", () => {
    expect(readCommandLog(useTempFile("tasker-read-log-", "verify.log", "1\n2\n3\n"), 20).tail).toBe("the last 3 lines of the log:\n1\n2\n3\n");
  });

  it("counts a last line with no line end", () => {
    expect(readCommandLog(useTempFile("tasker-read-log-", "verify.log", "1\n2"), 20).tail).toBe("the last 2 lines of the log:\n1\n2\n");
  });

  it("says that the log is missing", () => {
    const log = join(useTempDir("tasker-read-log-"), "none.log");
    expect(readCommandLog(log, 20)).toStrictEqual({ tail: `the log is missing: ${log}\n`, noOutput: false });
  });

  it("gives the error code of a log that cannot be read", () => {
    const log = join(useTempDir("tasker-read-log-"), "folder");
    mkdirSync(log);
    expect(readCommandLog(log, 20)).toStrictEqual({ tail: `cannot read the log ${log}: EISDIR\n`, noOutput: false });
  });

  it("has no output for a header and an outcome line", () => {
    expect(readCommandLog(useTempFile("tasker-read-log-", "verify.log", "$ exit 3\n--- exit code 3\n"), 20).noOutput).toBe(true);
  });

  it("has output for a log with output", () => {
    expect(readCommandLog(useTempFile("tasker-read-log-", "verify.log", "$ ls\nfile\n--- exit code 0\n"), 20).noOutput).toBe(false);
  });

  it("has no output for a header and an error line", () => {
    expect(readCommandLog(useTempFile("tasker-read-log-", "verify.log", "$ nope\n--- spawn ENOENT\n"), 20).noOutput).toBe(true);
  });
});

describe("textLines", () => {
  it("drops the empty last item of a text that ends with a line end", () => {
    expect(textLines("a\nb\n")).toEqual(["a", "b"]);
  });

  it("keeps the last line of a text with no final line end", () => {
    expect(textLines("a\nb")).toEqual(["a", "b"]);
  });

  it("gives no lines for an empty text", () => {
    expect(textLines("")).toEqual([]);
  });
});

describe("NO_OUTPUT_LINE", () => {
  it("gives the text of the no-output line", () => {
    expect(NO_OUTPUT_LINE).toBe(
      "The command produced no output. It usually failed before it reached the tool that it runs.",
    );
  });
});
