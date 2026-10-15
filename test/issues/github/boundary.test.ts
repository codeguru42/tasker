import { describe, expect, it } from "vitest";
import { breaksBoundary, filesThatBreakBoundary, filesThatStart } from "../../helpers/source-scan.js";

describe("the gh boundary", () => {
  it("finds the runner in src/issues/github", () => {
    const inside = filesThatStart("gh").filter((file) => file.startsWith("issues/github/"));
    expect(inside.length).toBeGreaterThan(0);
  });

  it("finds no file outside src/issues/github that starts gh", () => {
    const outside = filesThatStart("gh").filter((file) => !file.startsWith("issues/github/"));
    expect(outside).toEqual([]);
  });
});

describe("the issue provider boundary", () => {
  it("finds no file outside src/issues that imports from src/issues/github", () => {
    expect(filesThatBreakBoundary("issues/", "issues/github")).toEqual([]);
  });

  it.each([
    ["commands/x.ts", 'import { runGh } from "../issues/github/run.js";'],
    ["issue-key/resolve.ts", 'import { x } from "../issues/github/provider.js";'],
  ])("finds %s with %s", (file, sample) => {
    expect(breaksBoundary(file, sample, "issues/", "issues/github")).toBe(true);
  });

  it.each([
    ["commands/x.ts", 'import { issueProviderFor } from "../issues/provider.js";'],
    ["issues/provider.ts", 'import { createGithubProvider } from "./github/provider.js";'],
    ["commands/x.ts", 'import { x } from "../issues/githubx/run.js";'],
  ])("ignores %s with %s", (file, sample) => {
    expect(breaksBoundary(file, sample, "issues/", "issues/github")).toBe(false);
  });
});
