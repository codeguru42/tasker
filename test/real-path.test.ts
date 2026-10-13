import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalPath } from "../src/real-path.js";
import { useTempDir } from "./helpers.js";

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
