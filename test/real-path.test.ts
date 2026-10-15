import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalPath, isInside } from "../src/real-path.js";
import { useTempDir } from "./helpers/temp.js";

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
