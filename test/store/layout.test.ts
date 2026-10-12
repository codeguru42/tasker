import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDataRoot, dataRootLayout } from "../../src/store/layout.js";
import { makeTempDir } from "../helpers.js";

describe("dataRootLayout", () => {
  it("puts the folders and the database directly under the data root", () => {
    expect(dataRootLayout("/d")).toEqual({
      root: "/d",
      clones: "/d/clones",
      artifacts: "/d/artifacts",
      database: "/d/tasker.db",
    });
  });
});

describe("createDataRoot", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir("tasker-data-");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a missing root, clones and artifacts", () => {
    const root = join(dir, "root");
    const layout = createDataRoot(root);
    expect(layout).toEqual(dataRootLayout(root));
    for (const path of [root, layout.clones, layout.artifacts]) {
      expect(statSync(path).isDirectory()).toBe(true);
    }
    expect(existsSync(join(root, "worktrees"))).toBe(false);
  });

  it("keeps a top worktrees folder that exists", () => {
    const root = join(dir, "root");
    mkdirSync(join(root, "worktrees"), { recursive: true });
    writeFileSync(join(root, "worktrees", "keep.txt"), "kept");
    createDataRoot(root);
    expect(readFileSync(join(root, "worktrees", "keep.txt"), "utf8")).toBe("kept");
  });

  it("does not throw on a second call and keeps existing content", () => {
    const root = join(dir, "root");
    const layout = createDataRoot(root);
    mkdirSync(join(layout.clones, "repo"));
    writeFileSync(join(layout.clones, "keep.txt"), "kept");
    expect(() => createDataRoot(root)).not.toThrow();
    expect(readFileSync(join(layout.clones, "keep.txt"), "utf8")).toBe("kept");
    expect(statSync(join(layout.clones, "repo")).isDirectory()).toBe(true);
  });
});
