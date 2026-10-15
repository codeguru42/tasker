import { describe, expect, it } from "vitest";
import { cleanPath, isPlaceholder, PLACEHOLDER } from "../src/answer-checks.js";

function clean(path: string): string {
  return cleanPath(path);
}

function placeholder(text: string): boolean {
  return isPlaceholder(text);
}

describe("PLACEHOLDER", () => {
  it("is the message of a text that is too short", () => {
    expect(PLACEHOLDER).toBe("is a placeholder, not real text");
  });
});

describe("isPlaceholder", () => {
  it.each(["ab", " ab "])("is true for the short text %j", (text) => {
    expect(placeholder(text)).toBe(true);
  });

  it.each(["abc", " abc "])("is false for the long text %j", (text) => {
    expect(placeholder(text)).toBe(false);
  });
});

describe("cleanPath", () => {
  it("trims the path", () => {
    expect(clean("  src/a.ts  ")).toBe("src/a.ts");
  });

  it('removes a leading "./"', () => {
    expect(clean("./src/a.ts")).toBe("src/a.ts");
  });

  it('removes only one leading "./"', () => {
    expect(clean("././a")).toBe("./a");
  });

  it('trims before it removes the leading "./"', () => {
    expect(clean(" ./a ")).toBe("a");
  });

  it.each(["./", "   "])("gives an empty path for %j", (path) => {
    expect(clean(path)).toBe("");
  });
});
