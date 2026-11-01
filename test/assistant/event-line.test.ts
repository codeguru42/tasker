import { describe, expect, it } from "vitest";
import { numberOf, parseLine } from "../../src/assistant/event-line.js";
import { claudeSample } from "../helpers/fake-claude.js";

describe("numberOf", () => {
  it.each([0, 1.5, -2])("gives the finite number %s", (value) => {
    expect(numberOf(value)).toBe(value);
  });

  it.each([NaN, Infinity, "4", null, undefined, {}])("gives undefined for %s", (value) => {
    expect(numberOf(value)).toBeUndefined();
  });
});

describe("parseLine", () => {
  it("parses a line that holds an object", () => {
    const line = claudeSample("plain")[1];

    expect(parseLine(line)).toEqual(JSON.parse(line));
  });

  it.each([
    ["an empty line", ""],
    ["a line that does not parse", "not json"],
    ["a cut line", claudeSample("plain")[1].slice(0, 80)],
    ["a number", "3"],
    ["a string", '"text"'],
    ["null", "null"],
    ["a list", "[1,2]"],
  ])("gives undefined for %s", (_name, line) => {
    expect(parseLine(line)).toBeUndefined();
  });
});
