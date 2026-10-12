import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoPaths, repoSlug } from "../../../src/vcs/git/repo-paths.js";
import { isInside } from "../../helpers.js";

const hardKeys = [
  "a/b",
  "a_2fb",
  "a_b",
  "a.b",
  ".",
  "..",
  "-",
  "_",
  "A",
  "a",
  "a b",
  "ä",
  "a\\b",
  "x.lock",
  "😀",
  "a-b/c",
  "a/b-c",
  "%2f",
];

// A fixed linear congruential sequence, so each run gives the same keys.
function seededKeys(count: number): string[] {
  const alphabet = ["a", "b", "z", "0", "9", "A", "Z", "-", "_", "/", ".", " ", "ä", "ß", "😀"];
  let state = 12345;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state >>> 8;
  };
  const keys = new Set<string>();
  while (keys.size < count) {
    const length = 3 + (next() % 8);
    let key = "";
    for (let i = 0; i < length; i++) key += alphabet[next() % alphabet.length];
    keys.add(key);
  }
  return [...keys];
}

describe("repoPaths", () => {
  it("gives the clone, publish token and worktree folders of a repo", () => {
    expect(repoPaths("/d", "tasker")).toEqual({
      clone: "/d/clones/tasker/repo.git",
      publishTokens: "/d/clones/tasker/publish-tokens",
      worktrees: "/d/clones/tasker/worktrees",
    });
  });

  it("puts the worktrees next to the clone, outside the publish tokens and the clone", () => {
    const paths = repoPaths("/d", "tasker");
    expect(paths.worktrees).toBe(join("/d", "clones", repoSlug("tasker"), "worktrees"));
    expect(repoPaths("/d", "a/b").worktrees).toBe(join("/d", "clones", "a_2fb", "worktrees"));
    expect(isInside(paths.publishTokens, paths.worktrees)).toBe(false);
    expect(isInside(paths.worktrees, paths.publishTokens)).toBe(false);
    expect(isInside(paths.worktrees, paths.clone)).toBe(false);
  });
});

describe("repoSlug", () => {
  it("keeps a/b-c and a-b/c apart", () => {
    expect(repoSlug("a/b-c")).not.toBe(repoSlug("a-b/c"));
  });

  it("keeps A and a apart, also in lower case", () => {
    expect(repoSlug("A")).not.toBe(repoSlug("a"));
    expect(repoSlug("A").toLowerCase()).not.toBe(repoSlug("a").toLowerCase());
  });

  it("gives a safe folder name for each hard key", () => {
    for (const key of hardKeys) {
      const slug = repoSlug(key);
      expect(slug).toMatch(/^[a-z0-9_-]+$/);
      expect(slug).not.toBe(".");
      expect(slug).not.toBe("..");
    }
  });

  it("gives each hard key its own slug, also in lower case", () => {
    const slugs = hardKeys.map(repoSlug);
    expect(new Set(slugs).size).toBe(hardKeys.length);
    expect(new Set(slugs.map((slug) => slug.toLowerCase())).size).toBe(hardKeys.length);
  });

  it("gives 1000 generated keys their own slugs", () => {
    const keys = seededKeys(1000);
    expect(keys.length).toBe(1000);
    expect(new Set(keys.map(repoSlug)).size).toBe(keys.length);
  });

  it("throws for an empty key", () => {
    expect(() => repoSlug("")).toThrow("cannot make a repo slug from an empty repo key");
  });

  it("limits the slug to 255 bytes", () => {
    expect(Buffer.byteLength(repoSlug("x".repeat(255)))).toBe(255);
    expect(() => repoSlug("x".repeat(256))).toThrow("the repo key is too long for a folder name");
    expect(() => repoSlug("ä".repeat(43))).toThrow("the repo key is too long for a folder name");
  });
});
