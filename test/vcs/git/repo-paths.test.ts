import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathSlug } from "../../../src/issue-key/path-slug.js";
import { repoPaths, repoSlug } from "../../../src/vcs/git/repo-paths.js";
import { isInside } from "../../helpers.js";

describe("repoPaths", () => {
  it("gives the clone, publish token and worktree folders of a repo", () => {
    expect(repoPaths("/d", "tasker")).toEqual({
      clone: "/d/clones/tasker/bare-repo",
      publishTokens: "/d/clones/tasker/publish-tokens",
      worktrees: "/d/clones/tasker/worktrees",
    });
  });

  // The name must not end in .git. docs/dev/version-control.md (Sandbox write paths) gives the reason.
  it("gives a clone folder name that does not end in .git", () => {
    expect(basename(repoPaths("/d", "tasker").clone).endsWith(".git")).toBe(false);
  });

  it("puts the worktrees next to the clone, outside the publish tokens and the clone", () => {
    const paths = repoPaths("/d", "tasker");
    expect(paths.worktrees).toBe(join("/d", "clones", repoSlug("tasker"), "worktrees"));
    expect(repoPaths("/d", "a/b").worktrees).toBe(join("/d", "clones", repoSlug("a/b"), "worktrees"));
    expect(isInside(paths.publishTokens, paths.worktrees)).toBe(false);
    expect(isInside(paths.worktrees, paths.publishTokens)).toBe(false);
    expect(isInside(paths.worktrees, paths.clone)).toBe(false);
  });
});

describe("repoSlug", () => {
  it("keeps the case of a mixed-case key", () => {
    expect(repoSlug("CodeGuru42/Tasker")).toBe("CodeGuru42-Tasker");
  });

  it.each(["a/b", "my repo.v2", "x.lock", "a_b", "ä-x"])("uses the path slug for %j", (key) => {
    expect(repoSlug(key)).toBe(pathSlug(key));
  });

  it("gives a/b and a-b the same slug, a known limit", () => {
    expect(repoSlug("a/b")).toBe(repoSlug("a-b"));
  });

  it.each(["", "///", "ä"])("throws for the key %j", (key) => {
    expect(() => repoSlug(key)).toThrow(`cannot make a path slug from ${JSON.stringify(key)}`);
  });

  it("limits the slug to 255 bytes", () => {
    expect(repoSlug("x".repeat(255))).toHaveLength(255);
    expect(() => repoSlug("x".repeat(256))).toThrow("the repo key is too long for a folder name");
    expect(repoSlug(`${"a".repeat(255)}/`)).toHaveLength(255);
  });
});
