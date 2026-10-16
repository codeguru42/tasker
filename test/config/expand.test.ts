import { describe, expect, it } from "vitest";
import { expandPath } from "../../src/config/expand.js";

const home = "/home/me";

describe("expandPath", () => {
  it("expands a lone ~ to the home directory", () => {
    expect(expandPath("~", {}, home)).toBe("/home/me");
  });

  it("expands a leading ~/", () => {
    expect(expandPath("~/data", {}, home)).toBe("/home/me/data");
  });

  it("leaves a ~ in any other place", () => {
    expect(expandPath("a/~b", {}, home)).toBe("a/~b");
  });

  it("expands $NAME and ${NAME}", () => {
    const env = { ROOT: "/srv" };
    expect(expandPath("$ROOT/x", env, home)).toBe("/srv/x");
    expect(expandPath("${ROOT}/x", env, home)).toBe("/srv/x");
  });

  it("throws for a variable that is not set", () => {
    expect(() => expandPath("$MISSING/x", {}, home)).toThrow("references undefined environment variable $MISSING");
  });

  it("throws for a variable that is empty", () => {
    expect(() => expandPath("${EMPTY}/x", { EMPTY: "" }, home)).toThrow("$EMPTY");
  });
});
