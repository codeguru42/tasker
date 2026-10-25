import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalPath, deepestRealPath, isInside } from "../src/real-path.js";
import { useTempDir } from "./helpers/temp.js";

function deepest(path: string): string {
  return deepestRealPath(path);
}

describe("canonicalPath", () => {
  it("gives the real path of a real folder", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));
    mkdirSync(join(dir, "real"));

    expect(canonicalPath(join(dir, "real"))).toBe(join(dir, "real"));
  });

  it("gives the real parent plus the last part when the last part is missing", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));

    expect(canonicalPath(join(dir, "missing"))).toBe(join(dir, "missing"));
  });

  it("gives the real parent plus the last part for a path through a symlinked parent", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "link"));

    expect(canonicalPath(join(dir, "link", "wt"))).toBe(join(dir, "real", "wt"));
  });

  it("gives the resolved path when the parent is missing", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));
    const path = join(dir, "no", "such", "wt");

    expect(canonicalPath(path)).toBe(resolve(path));
  });
});

describe("isInside", () => {
  it("gives true for the folder itself and for a path inside it", () => {
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b/c", "/a/b")).toBe(true);
  });

  it("gives false for a sibling that starts with the folder name, and for the parent", () => {
    expect(isInside("/a/bc", "/a/b")).toBe(false);
    expect(isInside("/a", "/a/b")).toBe(false);
  });

  it("counts a child named ..x as inside", () => {
    expect(isInside("/a/b/..x", "/a/b")).toBe(true);
  });

  it("works for a folder that ends in the separator", () => {
    expect(isInside("/a", "/")).toBe(true);
    expect(isInside("/a/b", "/a/")).toBe(true);
  });
});

describe("deepestRealPath", () => {
  it("gives the real path of a folder that exists", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));

    expect(deepest(dir)).toBe(dir);
  });

  it("adds a missing tail to the folder that exists", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));

    expect(deepest(`${dir}/a/b/c.md`)).toBe(join(dir, "a/b/c.md"));
  });

  it("adds a missing tail to the target of a symlinked folder", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));
    const other = realpathSync(useTempDir("tasker-real-path-"));
    symlinkSync(other, join(dir, "link"));

    expect(deepest(`${dir}/link/a/b.md`)).toBe(join(other, "a/b.md"));
  });

  it("resolves a symlink before a .. that follows it", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));
    const other = realpathSync(useTempDir("tasker-real-path-"));
    mkdirSync(join(other, "sub"));
    symlinkSync(join(other, "sub"), join(dir, "link"));

    expect(deepest(`${dir}/link/../x`)).toBe(join(other, "x"));
  });

  it("resolves a .. in the missing tail as text", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));

    expect(deepest(`${dir}/missing/../../x`)).toBe(join(dirname(dir), "x"));
  });

  it("throws for a relative path", () => {
    expect(() => deepest("a/b")).toThrow("the path is not absolute");
  });
});
