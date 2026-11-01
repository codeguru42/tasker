import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readThreadId, readUsageTotal, writeThreadId, writeUsageTotal } from "../../../src/assistant/codex/session.js";
import { codexUsagePath } from "../../../src/store/layout.js";
import { CODEX_PLAIN_USAGE } from "../../helpers/fake-codex.js";
import { useTempDir } from "../../helpers/temp.js";

function setUp() {
  return useTempDir("tasker-codex-session-");
}

describe("the thread id file", () => {
  it("gives the id that was written", () => {
    const dir = setUp();

    writeThreadId(dir, "s1", "T1");

    expect(readThreadId(dir, "s1")).toBe("T1");
  });

  it("replaces the id on a second write", () => {
    const dir = setUp();

    writeThreadId(dir, "s1", "T1");
    writeThreadId(dir, "s1", "T2");

    expect(readThreadId(dir, "s1")).toBe("T2");
  });

  it("keeps one file for each session id", () => {
    const dir = setUp();

    writeThreadId(dir, "s1", "T1");
    writeThreadId(dir, "s2", "T2");

    expect([readThreadId(dir, "s1"), readThreadId(dir, "s2")]).toEqual(["T1", "T2"]);
  });

  it("gives undefined for a missing file", () => {
    expect(readThreadId(setUp(), "s1")).toBeUndefined();
  });

  it("gives undefined for a file with only white space", () => {
    const dir = setUp();
    writeThreadId(dir, "s1", " \n\t");

    expect(readThreadId(dir, "s1")).toBeUndefined();
  });

  it("throws for the caller to catch when the folder is missing", () => {
    expect(() => writeThreadId(join(setUp(), "missing"), "s1", "T1")).toThrow();
  });
});

describe("the usage file", () => {
  it("gives the four fields that were written", () => {
    const dir = setUp();

    writeUsageTotal(dir, "s1", CODEX_PLAIN_USAGE);

    expect(readUsageTotal(dir, "s1")).toEqual(CODEX_PLAIN_USAGE);
  });

  it("gives undefined for a missing file", () => {
    expect(readUsageTotal(setUp(), "s1")).toBeUndefined();
  });

  it("gives undefined for a file that does not parse", () => {
    const dir = setUp();
    writeFileSync(codexUsagePath(dir, "s1"), "not json");

    expect(readUsageTotal(dir, "s1")).toBeUndefined();
  });

  it("gives undefined when a field is not a number", () => {
    const dir = setUp();
    writeFileSync(codexUsagePath(dir, "s1"), JSON.stringify({ ...CODEX_PLAIN_USAGE, outputTokens: "6" }));

    expect(readUsageTotal(dir, "s1")).toBeUndefined();
  });

  it("gives undefined when a field is missing", () => {
    const dir = setUp();
    writeFileSync(codexUsagePath(dir, "s1"), JSON.stringify({ inputTokens: 1 }));

    expect(readUsageTotal(dir, "s1")).toBeUndefined();
  });

  it("throws for the caller to catch when the folder is missing", () => {
    expect(() => writeUsageTotal(join(setUp(), "missing"), "s1", CODEX_PLAIN_USAGE)).toThrow();
  });
});
