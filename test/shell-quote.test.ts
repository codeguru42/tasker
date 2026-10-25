import { describe, expect, it } from "vitest";
import { shellQuote } from "../src/shell-quote.js";

function quote(text: string): string {
  return shellQuote(text);
}

describe("shellQuote", () => {
  it("puts a plain text in single quotes", () => {
    expect(quote("abc")).toBe("'abc'");
  });

  it("writes each single quote as '\\''", () => {
    expect(quote("it's")).toBe("'it'\\''s'");
  });
});
