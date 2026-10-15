import { describe, expect, it } from "vitest";
import { compareText } from "../src/compare-text.js";

describe("compareText", () => {
  it("gives a negative number for a smaller text", () => {
    expect(compareText("a", "b")).toBeLessThan(0);
  });

  it("gives a positive number for a larger text", () => {
    expect(compareText("b", "a")).toBeGreaterThan(0);
  });

  it("gives 0 for equal texts", () => {
    expect(compareText("a", "a")).toBe(0);
  });

  it("orders by code unit, not by locale", () => {
    expect(["a", "B"].sort(compareText)).toEqual(["B", "a"]);
  });
});
