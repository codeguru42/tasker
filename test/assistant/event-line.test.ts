import { describe, expect, it } from "vitest";
import { appendEventLine, numberOf, parseLine } from "../../src/assistant/event-line.js";
import type { AssistantEvent } from "../../src/assistant/provider.js";
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

function append(line: string, events: AssistantEvent[], onEvent?: (event: AssistantEvent) => void) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return appendEventLine(line, events, onEvent);
}

describe("appendEventLine", () => {
  it("parses and appends events in order", () => {
    const events: AssistantEvent[] = [];
    const delivered: AssistantEvent[] = [];
    const first = { type: "first" };
    const second = { type: "second" };

    const result = append(JSON.stringify(first), events, (event) => delivered.push(event));
    append(JSON.stringify(second), events);

    expect(result).toBeUndefined();
    expect(events).toEqual([first, second]);
    expect(delivered).toEqual([first]);
  });

  it("protects event delivery when the listener throws", () => {
    const events: AssistantEvent[] = [];
    const listener = () => {
      throw new Error("listener broke");
    };

    expect(() => append('{"type":"message"}', events, listener)).not.toThrow();
    expect(events).toEqual([{ type: "message" }]);
  });
});
