import { describe, expect, it } from "vitest";
import { branchOfBase } from "../../src/vcs/local-branch.js";

describe("branchOfBase", () => {
  it.each([
    ["refs/heads/topic", "topic"],
    ["epic", "epic"],
  ])("maps the stored base %s to the branch %s", (base, branch) => {
    expect(branchOfBase(base)).toBe(branch);
  });
});
