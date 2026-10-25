import { describe, expect, it } from "vitest";
import { breaksBoundary, filesThatBreakBoundary, filesThatStart } from "../../helpers/source-scan.js";

describe("the acli boundary", () => {
  it("finds the runner in src/issues/jira", () => {
    const inside = filesThatStart("acli").filter((file) => file.startsWith("issues/jira/"));
    expect(inside.length).toBeGreaterThan(0);
  });

  it("finds no file outside src/issues/jira that starts acli", () => {
    const outside = filesThatStart("acli").filter((file) => !file.startsWith("issues/jira/"));
    expect(outside).toEqual([]);
  });
});

describe("the issue provider boundary for Jira", () => {
  it("finds no file outside src/issues that imports from src/issues/jira", () => {
    expect(filesThatBreakBoundary("issues/", "issues/jira")).toEqual([]);
  });

  it("finds commands/x.ts with an import of the runner", () => {
    const sample = 'import { runAcli } from "../issues/jira/run.js";';
    expect(breaksBoundary("commands/x.ts", sample, "issues/", "issues/jira")).toBe(true);
  });

  it.each([
    ["issues/provider.ts", 'import { x } from "./jira/run.js";'],
    ["commands/x.ts", 'import { x } from "../issues/jirax/run.js";'],
  ])("ignores %s with %s", (file, sample) => {
    expect(breaksBoundary(file, sample, "issues/", "issues/jira")).toBe(false);
  });
});
