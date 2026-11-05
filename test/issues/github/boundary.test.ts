import { describe, expect, it } from "vitest";
import {
  breaksBoundary,
  filesThatBreakBoundary,
  filesThatImport,
  filesThatStart,
  importsPath,
  sourceDir,
} from "../../helpers/source-scan.js";
import { join } from "node:path";

function breaksGithubBoundary(file: string, text: string): boolean {
  const allowed = ["github/", "issues/github/", "forge/github/"].some((prefix) => file.startsWith(prefix));
  return !allowed && importsPath(file, text, join(sourceDir, "github"));
}

describe("the gh boundary", () => {
  it("finds the shared runner in src/github", () => {
    const inside = filesThatStart("gh").filter((file) => file.startsWith("github/"));
    expect(inside.length).toBeGreaterThan(0);
  });

  it("finds no file outside src/github that starts gh", () => {
    const outside = filesThatStart("gh").filter((file) => !file.startsWith("github/"));
    expect(outside).toEqual([]);
  });

  it("finds no importer of src/github outside its allowed folders", () => {
    const allowed = ["github/", "issues/github/", "forge/github/"];
    const outside = filesThatImport("github").filter((file) => !allowed.some((prefix) => file.startsWith(prefix)));
    expect(outside).toEqual([]);
  });

  it.each([
    ["issues/github/run.ts", 'import { runGhProcess } from "../../github/process.js";', false],
    ["commands/show.ts", 'import { runGhProcess } from "../github/process.js";', true],
  ])("checks GitHub implementation imports from %s", (file, sample, expected) => {
    expect(breaksGithubBoundary(file, sample)).toBe(expected);
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
