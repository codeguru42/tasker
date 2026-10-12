import { describe, expect, it } from "vitest";
import { filesThatStart } from "../../helpers.js";

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
