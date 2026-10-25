import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isRunnableFile } from "../../src/process/resolve-program.js";
import { writeFakeCommand } from "../helpers/fake-commands.js";
import { useTempDir } from "../helpers/temp.js";

describe("isRunnableFile", () => {
  it("gives true for a script that the user can run", () => {
    const dir = useTempDir("tasker-runnable-");
    writeFakeCommand(dir, "prog", "exit 0");

    expect(isRunnableFile(join(dir, "prog"))).toBe(true);
  });

  it("gives false for a file that the user cannot run", () => {
    const dir = useTempDir("tasker-runnable-");
    const file = join(dir, "plain");
    writeFileSync(file, "x");
    chmodSync(file, 0o644);

    expect(isRunnableFile(file)).toBe(false);
  });

  it("gives false for a folder", () => {
    const dir = useTempDir("tasker-runnable-");
    const folder = join(dir, "folder");
    mkdirSync(folder);

    expect(isRunnableFile(folder)).toBe(false);
  });

  it("gives false for a path that does not exist", () => {
    const dir = useTempDir("tasker-runnable-");

    expect(isRunnableFile(join(dir, "missing"))).toBe(false);
  });

  it("gives false for a path under a regular file", () => {
    const dir = useTempDir("tasker-runnable-");
    const file = join(dir, "plain");
    writeFileSync(file, "x");

    expect(isRunnableFile(join(file, "child"))).toBe(false);
  });
});
