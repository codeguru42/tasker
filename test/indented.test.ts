import { describe, expect, it } from "vitest";
import { indented } from "../src/indented.js";

function indent(prefix: string, text: string): string {
  return indented(prefix, text);
}

describe("indented", () => {
  it("puts the prefix before one line", () => {
    expect(indent("  ", "a")).toBe("  a");
  });

  it.each([
    ["LF", "a\nb"],
    ["CRLF", "a\r\nb"],
    ["CR", "a\rb"],
  ])("puts the prefix before each line of a text with %s line ends", (_name, text) => {
    expect(indent("  ", text)).toBe("  a\n  b");
  });

  it("gives the prefix alone for an empty text", () => {
    expect(indent("  ", "")).toBe("  ");
  });
});
