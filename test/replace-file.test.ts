import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { errnoCode } from "../src/errno.js";
import { replaceFile } from "../src/replace-file.js";
import { thrownBy, useTempDir } from "./helpers.js";

describe("replaceFile", () => {
  it("writes the new text and leaves no other file in the folder", () => {
    const dir = useTempDir("tasker-replace-");
    const path = join(dir, "config.json");
    writeFileSync(path, "old");

    replaceFile(path, "new");

    expect(readFileSync(path, "utf8")).toBe("new");
    expect(readdirSync(dir)).toEqual(["config.json"]);
  });

  it("keeps the mode of the file", () => {
    const dir = useTempDir("tasker-replace-");
    const path = join(dir, "config.json");
    writeFileSync(path, "old", { mode: 0o600 });

    replaceFile(path, "new");

    expect(statSync(path).mode & 0o7777).toBe(0o600);
  });

  it("keeps a symlink and writes the new text to its target", () => {
    const dir = useTempDir("tasker-replace-");
    const target = join(dir, "target.json");
    const link = join(dir, "link.json");
    writeFileSync(target, "old");
    symlinkSync(target, link);

    replaceFile(link, "new");

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("new");
    expect(readdirSync(dir).sort()).toEqual(["link.json", "target.json"]);
  });

  it("throws ENOENT and keeps a broken symlink when it follows links", () => {
    const dir = useTempDir("tasker-replace-");
    const link = join(dir, "link.json");
    const missing = join(dir, "missing.json");
    symlinkSync(missing, link);

    const error = thrownBy(() => replaceFile(link, "new"));

    expect(errnoCode(error)).toBe("ENOENT");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(missing);
    expect(readdirSync(dir)).toEqual(["link.json"]);
  });

  it("replaces a symlink with a regular file when followSymlink is false", () => {
    const dir = useTempDir("tasker-replace-");
    const outside = useTempDir("tasker-replace-outside-");
    const target = join(outside, "target.json");
    const link = join(dir, "link.json");
    writeFileSync(target, "old");
    chmodSync(target, 0o600);
    symlinkSync(target, link);

    replaceFile(link, "new", { followSymlink: false });

    expect(lstatSync(link).isFile()).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(false);
    expect(readFileSync(link, "utf8")).toBe("new");
    expect(readFileSync(target, "utf8")).toBe("old");
    expect(statSync(target).mode & 0o7777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["link.json"]);
  });

  it("gives the file that replaces a symlink the mode of the option and leaves the target alone", () => {
    const dir = useTempDir("tasker-replace-");
    const outside = useTempDir("tasker-replace-outside-");
    const target = join(outside, "target.json");
    const link = join(dir, "link.json");
    writeFileSync(target, "old");
    chmodSync(target, 0o600);
    symlinkSync(target, link);

    replaceFile(link, "new", { followSymlink: false, mode: 0o755 });

    expect(lstatSync(link).isFile()).toBe(true);
    expect(statSync(link).mode & 0o7777).toBe(0o755);
    expect(readFileSync(target, "utf8")).toBe("old");
    expect(statSync(target).mode & 0o7777).toBe(0o600);
  });

  it("throws and leaves no temp file when the rename fails", () => {
    const dir = useTempDir("tasker-replace-");
    mkdirSync(join(dir, "target"));
    const link = join(dir, "link");
    symlinkSync(join(dir, "target"), link);

    expect(() => replaceFile(link, "new")).toThrow();

    expect(readdirSync(dir).sort()).toEqual(["link", "target"]);
    expect(readdirSync(join(dir, "target"))).toEqual([]);
  });

  it("writes a new file when nothing is at the path", () => {
    const dir = useTempDir("tasker-replace-");
    const path = join(dir, "new.json");

    replaceFile(path, "new");

    expect(readFileSync(path, "utf8")).toBe("new");
    expect(readdirSync(dir)).toEqual(["new.json"]);
  });

  it("gives a new file the mode of the option, also when the umask removes bits", () => {
    const dir = useTempDir("tasker-replace-");
    const path = join(dir, "hook");
    const before = process.umask(0o077);
    try {
      replaceFile(path, "new", { mode: 0o755 });
    } finally {
      process.umask(before);
    }

    expect(statSync(path).mode & 0o7777).toBe(0o755);
  });

  it("gives an existing file the mode of the option", () => {
    const dir = useTempDir("tasker-replace-");
    const path = join(dir, "hook");
    writeFileSync(path, "old", { mode: 0o600 });
    chmodSync(path, 0o600);

    replaceFile(path, "new", { mode: 0o755 });

    expect(statSync(path).mode & 0o7777).toBe(0o755);
  });

  it("gives a new file with no mode the mode that the umask gives", () => {
    const dir = useTempDir("tasker-replace-");
    const path = join(dir, "plain");
    const before = process.umask(0o022);
    try {
      replaceFile(path, "new");
    } finally {
      process.umask(before);
    }

    expect(statSync(path).mode & 0o7777).toBe(0o644);
  });

  it("throws ENOENT and leaves no file when the parent folder of a new file is missing", () => {
    const dir = useTempDir("tasker-replace-");
    const thrown = thrownBy(() => replaceFile(join(dir, "missing", "file"), "new"));

    expect(errnoCode(thrown)).toBe("ENOENT");
    expect(readdirSync(dir)).toEqual([]);
  });
});
