import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalPath, isDeniedPath, isInside, realPathWithMissingParents } from "../src/real-path.js";
import { thrownBy } from "./helpers/errors.js";
import { useTempDir } from "./helpers/temp.js";

function realPath(path: string): string {
  return realPathWithMissingParents(path);
}

function denied(path: string, entries: readonly string[]): boolean {
  return isDeniedPath(path, entries);
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

describe("realPathWithMissingParents", () => {
  it("resolves a missing parent chain after the longest existing parent", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "link"));
    const path = join(dir, "link", "missing", "child");

    expect(realPath(path)).toBe(join(dir, "real", "missing", "child"));
  });

  it("resolves a link in a middle path component", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));
    mkdirSync(join(dir, "target", "inner"), { recursive: true });
    symlinkSync(join(dir, "target"), join(dir, "middle"));
    writeFileSync(join(dir, "target", "inner", "file"), "x");

    expect(realPath(join(dir, "middle", "inner", "file"))).toBe(join(dir, "target", "inner", "file"));
  });

  it("throws for a dangling link", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));
    symlinkSync(join(dir, "missing-target"), join(dir, "dangling"));

    const error = thrownBy(() => realPath(join(dir, "dangling", "child")));

    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
  });

  it("throws for a link loop", () => {
    const dir = realpathSync(useTempDir("tasker-real-path-"));
    symlinkSync(join(dir, "loop"), join(dir, "loop"));

    const error = thrownBy(() => realPath(join(dir, "loop", "child")));

    expect((error as NodeJS.ErrnoException).code).toBe("ELOOP");
  });
});

describe("isDeniedPath", () => {
  it("matches an exact denial", () => {
    expect(denied("/work/private", ["/work/private"])).toBe(true);
  });

  it("matches the base and descendants of a /** denial", () => {
    expect(denied("/work/private", ["/work/private/**"])).toBe(true);
    expect(denied("/work/private/file", ["/work/private/**"])).toBe(true);
  });

  it("does not match a sibling that shares the denied path prefix", () => {
    expect(denied("/work/private-old/file", ["/work/private/**"])).toBe(false);
    expect(denied("/work/private-old", ["/work/private"])).toBe(false);
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
