import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeParentFolders } from "../src/parent-folders.js";
import { useTempDir } from "./helpers/temp.js";

describe("makeParentFolders", () => {
  it("makes the missing parents of a path", () => {
    const dir = useTempDir("tasker-parent-folders-");
    const path = join(dir, "a", "b", "c.txt");
    makeParentFolders(path);
    expect(statSync(join(dir, "a", "b")).isDirectory()).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("leaves a parent that exists", () => {
    const dir = useTempDir("tasker-parent-folders-");
    writeFileSync(join(dir, "first.txt"), "first");
    makeParentFolders(join(dir, "c.txt"));
    expect(readdirSync(dir)).toEqual(["first.txt"]);
  });

  it("passes the error when a file stands in the place of a parent", () => {
    const dir = useTempDir("tasker-parent-folders-");
    writeFileSync(join(dir, "a"), "text");
    expect(() => makeParentFolders(join(dir, "a", "b", "c.txt"))).toThrow(/ENOTDIR/);
    expect(readFileSync(join(dir, "a"), "utf8")).toBe("text");
  });
});
