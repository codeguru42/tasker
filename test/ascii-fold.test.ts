import { describe, expect, it } from "vitest";
import { asciiFold } from "../src/ascii-fold.js";

function folded(text: string): string {
  return asciiFold(text);
}

describe("asciiFold", () => {
  it.each([
    ["A", "a"],
    ["Z", "z"],
    ["OWNER/Repo", "owner/repo"],
  ])("folds %j to %j", (text, expected) => {
    expect(folded(text)).toBe(expected);
  });

  it.each(["abc", "0123456789"])("keeps %j as it is", (text) => {
    expect(folded(text)).toBe(text);
  });

  it("keeps the non-ASCII letter Ü as it is", () => {
    expect(folded("Ü")).toBe("Ü");
  });

  it("keeps the Kelvin sign U+212A as it is", () => {
    expect(folded("\u212A")).toBe("\u212A");
  });
});
