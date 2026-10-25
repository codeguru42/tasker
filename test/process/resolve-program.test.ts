import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isRunnableFile, ProgramFileError, resolveProgram } from "../../src/process/resolve-program.js";
import { thrownBy } from "../helpers/errors.js";
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

describe("resolveProgram", () => {
  const resolve = (env: NodeJS.ProcessEnv) => resolveProgram("prog", "TASKER_X_BIN", env);
  const messageFor = (value: string) => `TASKER_X_BIN is ${value}, but ${value} is not a file that you can run`;

  it("gives the name when the variable is not set", () => {
    expect(resolve({})).toBe("prog");
  });

  it.each(["", "  "])("gives the name when the variable is %j", (value) => {
    expect(resolve({ TASKER_X_BIN: value })).toBe("prog");
  });

  it("gives an absolute path as it is", () => {
    const dir = useTempDir("tasker-resolve-");
    writeFakeCommand(dir, "mine", "exit 0");
    const path = join(dir, "mine");

    expect(resolve({ TASKER_X_BIN: path })).toBe(path);
  });

  it("resolves a relative path against the cwd", () => {
    const dir = useTempDir("tasker-resolve-");
    writeFakeCommand(dir, "mine", "exit 0");
    const value = relative(process.cwd(), join(dir, "mine"));
    expect(value).toContain("/");

    expect(resolve({ TASKER_X_BIN: value })).toBe(join(dir, "mine"));
  });

  it("throws for a file that does not exist", () => {
    const dir = useTempDir("tasker-resolve-");
    const value = join(dir, "missing");

    const error = thrownBy(() => resolve({ TASKER_X_BIN: value }));

    expect(error).toBeInstanceOf(ProgramFileError);
    expect(error).toMatchObject({
      name: "ProgramFileError",
      message: messageFor(value),
      variable: "TASKER_X_BIN",
      value,
    });
  });

  it("throws for a file that the user cannot run", () => {
    const dir = useTempDir("tasker-resolve-");
    const value = join(dir, "plain");
    writeFileSync(value, "x");
    chmodSync(value, 0o644);

    const error = thrownBy(() => resolve({ TASKER_X_BIN: value }));

    expect(error).toBeInstanceOf(ProgramFileError);
    expect(error).toMatchObject({ message: messageFor(value), variable: "TASKER_X_BIN", value });
  });

  it("throws for a folder", () => {
    const value = useTempDir("tasker-resolve-");

    const error = thrownBy(() => resolve({ TASKER_X_BIN: value }));

    expect(error).toBeInstanceOf(ProgramFileError);
    expect(error).toMatchObject({ message: messageFor(value), variable: "TASKER_X_BIN", value });
  });

  it("gives a name without a slash as it is", () => {
    expect(resolve({ TASKER_X_BIN: "fake-name" })).toBe("fake-name");
  });
});
