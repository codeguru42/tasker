import { lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replaceFile } from "../src/replace-file.js";
import { useTempDir } from "./helpers.js";

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

  it("throws and leaves no temp file when the rename fails", () => {
    const dir = useTempDir("tasker-replace-");
    mkdirSync(join(dir, "target"));
    const link = join(dir, "link");
    symlinkSync(join(dir, "target"), link);

    expect(() => replaceFile(link, "new")).toThrow();

    expect(readdirSync(dir).sort()).toEqual(["link", "target"]);
    expect(readdirSync(join(dir, "target"))).toEqual([]);
  });
});
