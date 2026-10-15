import { describe, expect, it } from "vitest";
import { rulesOf } from "./prompts.js";

function rules(prompt: string): string[] {
  return rulesOf(prompt);
}

describe("rulesOf", () => {
  it("gives the numbered lines and skips the sub-items", () => {
    expect(rules("1. a\n   - b\n2. c\n")).toEqual(["1. a", "2. c"]);
  });

  it("counts a line with a two-digit number", () => {
    expect(rules("10. x")).toEqual(["10. x"]);
  });

  it.each(["x 1. y", "1.x"])("does not count the line %j", (line) => {
    expect(rules(line)).toEqual([]);
  });
});
