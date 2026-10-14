import { describe, expect, it } from "vitest";
import { firstLine } from "../../src/doctor/first-line.js";

describe("firstLine", () => {
  it("gives the first of several lines", () => {
    expect(firstLine("one\ntwo\nthree\n")).toBe("one");
  });

  it("removes the \\r of a \\r\\n line end", () => {
    expect(firstLine("one\r\ntwo\r\n")).toBe("one");
  });

  it("gives a text with no line end as it is", () => {
    expect(firstLine("one")).toBe("one");
  });

  it("gives an empty text as an empty line", () => {
    expect(firstLine("")).toBe("");
  });

  it("gives an empty line for a text that starts with a line end", () => {
    expect(firstLine("\none")).toBe("");
  });

  it("keeps a \\r inside the line", () => {
    expect(firstLine("on\re\ntwo")).toBe("on\re");
  });
});
