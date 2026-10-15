import { readErrorText, readTextFile } from "../src/read-text-file.js";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { useTempDir, useTempFile } from "./helpers/temp.js";

describe("readTextFile", () => {
  it("gives the text of a file", () => {
    const path = useTempFile("tasker-read-text-", "a.txt", "hello\nworld");
    expect(readTextFile(path)).toEqual({ text: "hello\nworld" });
  });

  it("gives the empty text of an empty file", () => {
    const path = useTempFile("tasker-read-text-", "a.txt", "");
    expect(readTextFile(path)).toEqual({ text: "" });
  });

  it("gives missing and ENOENT for a path that does not exist", () => {
    const path = join(useTempDir("tasker-read-text-"), "missing.txt");
    expect(readTextFile(path)).toMatchObject({ text: undefined, missing: true, error: "ENOENT" });
  });

  it("gives EISDIR and the thrown error as cause for a folder", () => {
    const dir = useTempDir("tasker-read-text-");
    const file = readTextFile(dir);
    expect(file).toMatchObject({ text: undefined, missing: false, error: "EISDIR" });
    expect("cause" in file && file.cause).toBeInstanceOf(Error);
    expect("cause" in file && (file.cause as NodeJS.ErrnoException).code).toBe("EISDIR");
  });
});

describe("readErrorText", () => {
  it("gives the code of an error with a code", () => {
    expect(readErrorText(Object.assign(new Error("x"), { code: "EPERM" }))).toBe("EPERM");
  });

  it("gives the message of an Error with no code", () => {
    expect(readErrorText(new Error("boom"))).toBe("boom");
  });

  it("gives the text of a value that is not an Error", () => {
    expect(readErrorText("text")).toBe("text");
  });
});
