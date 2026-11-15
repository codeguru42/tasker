import { describe, expect, it } from "vitest";
import { piSandboxLimits } from "./pi-sandbox.js";

describe("piSandboxLimits", () => {
  it("gives every field a default", () => {
    expect(piSandboxLimits()).toEqual({
      bwrap: "/usr/bin/bwrap",
      worktree: "/work",
      writePaths: [],
      tempFolder: "/start",
      hidePaths: [],
    });
  });

  it("lets an override replace a field and keeps the others", () => {
    expect(piSandboxLimits({ worktree: "/other", writePaths: ["/a"] })).toEqual({
      bwrap: "/usr/bin/bwrap",
      worktree: "/other",
      writePaths: ["/a"],
      tempFolder: "/start",
      hidePaths: [],
    });
  });

  it("returns a new object with new lists for each call", () => {
    const one = piSandboxLimits();
    const two = piSandboxLimits();

    expect(one).not.toBe(two);
    expect(one.writePaths).not.toBe(two.writePaths);
  });
});
