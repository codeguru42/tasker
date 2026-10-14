import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeThroughTemp } from "../../../src/vcs/git/temp-write.js";
import { useTempDir } from "../../helpers.js";

describe("writeThroughTemp", () => {
  it("writes a new file with the text", () => {
    const path = join(useTempDir("tasker-temp-write-"), "file");
    writeThroughTemp(path, "hello\n");
    expect(readFileSync(path, "utf8")).toBe("hello\n");
  });

  it("replaces an existing file", () => {
    const path = join(useTempDir("tasker-temp-write-"), "file");
    writeFileSync(path, "old");
    writeThroughTemp(path, "new");
    expect(readFileSync(path, "utf8")).toBe("new");
  });

  it("leaves no temp file", () => {
    const path = join(useTempDir("tasker-temp-write-"), "file");
    writeThroughTemp(path, "x");
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it("sets the mode of the file, also when the umask removes bits", () => {
    const path = join(useTempDir("tasker-temp-write-"), "file");
    const before = process.umask(0o077);
    try {
      writeThroughTemp(path, "x", 0o755);
    } finally {
      process.umask(before);
    }
    expect(statSync(path).mode & 0o777).toBe(0o755);
  });
});
