import { describe, expect, it } from "vitest";
import type { AssistantEvent } from "../../../src/assistant/provider.js";
import { parseLine, readStream } from "../../../src/assistant/claude-code/stream.js";
import { claudeSample } from "../../helpers.js";

function sampleEvents(name: string): AssistantEvent[] {
  return claudeSample(name).map((line) => JSON.parse(line) as AssistantEvent);
}

function copyOf(event: AssistantEvent | undefined): AssistantEvent {
  return structuredClone(event!);
}

function messageOf(event: AssistantEvent): Record<string, unknown> {
  return event["message"] as Record<string, unknown>;
}

describe("parseLine", () => {
  it("parses a line that holds an object", () => {
    const line = claudeSample("plain")[1]!;

    expect(parseLine(line)).toEqual(JSON.parse(line));
  });

  it.each([
    ["an empty line", ""],
    ["a line that does not parse", "not json"],
    ["a cut line", claudeSample("plain")[1]!.slice(0, 80)],
    ["a number", "3"],
    ["a string", '"text"'],
    ["null", "null"],
    ["a list", "[1,2]"],
  ])("gives undefined for %s", (_name, line) => {
    expect(parseLine(line)).toBeUndefined();
  });
});

describe("readStream result and denials", () => {
  it("takes the last event as the result when it is a result event", () => {
    const events = sampleEvents("plain");

    expect(readStream(events).result).toBe(events[3]);
  });

  it("has no result when the last event is not a result event", () => {
    const facts = readStream(sampleEvents("plain").slice(0, 3));

    expect(facts.result).toBeUndefined();
    expect(facts.permissionDenials).toEqual([]);
  });

  it("maps the denials of the result", () => {
    const facts = readStream(sampleEvents("denied-tool"));

    expect(facts.permissionDenials).toEqual([
      { tool: "Write", input: { file_path: "/work/note.txt", content: "hi" } },
    ]);
  });

  it("gives no denials for a result with none", () => {
    expect(readStream(sampleEvents("plain")).permissionDenials).toEqual([]);
  });

  it("gives no denials when the field is not a list", () => {
    const events = sampleEvents("denied-tool");
    const result = copyOf(events.at(-1));
    result["permission_denials"] = "none";

    expect(readStream([...events.slice(0, -1), result]).permissionDenials).toEqual([]);
  });

  it("gives no denials when the denials are in a stream that does not end with the result", () => {
    expect(readStream(sampleEvents("denied-tool").slice(0, -1)).permissionDenials).toEqual([]);
  });

  it("skips an item that is not an object or has no string tool_name", () => {
    const events = sampleEvents("denied-tool");
    const result = copyOf(events.at(-1));
    const good = (result["permission_denials"] as Record<string, unknown>[])[0]!;
    const noName = { ...good };
    delete noName["tool_name"];
    result["permission_denials"] = ["text", null, noName, { ...good, tool_name: 5 }, good];

    expect(readStream([...events.slice(0, -1), result]).permissionDenials).toEqual([
      { tool: "Write", input: { file_path: "/work/note.txt", content: "hi" } },
    ]);
  });
});

describe("readStream reportedModel", () => {
  it("gives the model of the message", () => {
    expect(readStream(sampleEvents("plain")).reportedModel).toBe("claude-haiku-5-5");
  });

  it("keeps the suffix of init when the message model is its prefix", () => {
    expect(readStream(sampleEvents("sonnet-1m")).reportedModel).toBe("claude-sonnet-5-5[1m]");
  });

  it("skips a subagent message", () => {
    const events = sampleEvents("plain");
    const subagent = copyOf(events[1]);
    subagent["parent_tool_use_id"] = "toolu_01TjGQvm7AaDRBgi1f4Jq2WY";
    messageOf(subagent)["model"] = "claude-sonnet-5-5";

    expect(readStream([events[0]!, subagent, ...events.slice(1)]).reportedModel).toBe("claude-haiku-5-5");
  });

  it("skips a synthetic message", () => {
    const events = sampleEvents("plain");
    const synthetic = copyOf(events[1]);
    messageOf(synthetic)["model"] = "<synthetic>";

    expect(readStream([events[0]!, synthetic, ...events.slice(1)]).reportedModel).toBe("claude-haiku-5-5");
  });

  it("gives the message model when init has two suffixes", () => {
    const events = sampleEvents("sonnet-1m");
    const init = copyOf(events[0]);
    init["model"] = "claude-sonnet-5-5[1m][extra]";

    expect(readStream([init, ...events.slice(1)]).reportedModel).toBe("claude-sonnet-5-5");
  });

  it("gives the message model when init names another model", () => {
    const events = sampleEvents("plain");
    const init = copyOf(events[0]);
    init["model"] = "claude-sonnet-5-5[1m]";

    expect(readStream([init, ...events.slice(1)]).reportedModel).toBe("claude-haiku-5-5");
  });

  it("gives no model when no assistant event exists", () => {
    const events = sampleEvents("plain");

    expect(readStream([events[0]!, events[3]!]).reportedModel).toBeUndefined();
  });

  it("does not read modelUsage", () => {
    const events = sampleEvents("plain");
    const result = copyOf(events[3]);
    result["modelUsage"] = { "claude-other-1": {} };

    expect(readStream([...events.slice(0, 3), result]).reportedModel).toBe("claude-haiku-5-5");
  });
});

describe("readStream usage", () => {
  it.each([
    ["plain", 2, 4, 14964, 10978],
    ["json-schema", 6, 106, 26144, 26050],
    ["denied-tool", 4, 306, 12859, 39570],
    ["resume", 2, 4, 11693, 14290],
    ["sonnet-1m", 2, 4, 14191, 10978],
  ])("gives the totals of the result of %s", (name, inputTokens, outputTokens, creation, read) => {
    expect(readStream(sampleEvents(name)).usage).toEqual({
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: creation,
      cacheReadInputTokens: read,
    });
  });

  it("does not sum the assistant events", () => {
    const events = sampleEvents("json-schema");
    const summed = events
      .filter((event) => event["type"] === "assistant")
      .reduce((sum, event) => sum + (messageOf(event)["usage"] as { output_tokens: number }).output_tokens, 0);

    expect(summed).toBe(32);
    expect(readStream(events).usage).toMatchObject({ outputTokens: 106 });
  });

  it("counts a field that is missing or not a number as 0", () => {
    const events = sampleEvents("plain");
    const result = copyOf(events[3]);
    const usage = result["usage"] as Record<string, unknown>;
    delete usage["input_tokens"];
    usage["output_tokens"] = "4";

    expect(readStream([...events.slice(0, 3), result]).usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 14964,
      cacheReadInputTokens: 10978,
    });
  });

  it("is unavailable when the last event is not a result", () => {
    expect(readStream(sampleEvents("plain").slice(0, 3)).usage).toBe("unavailable");
  });

  it("is unavailable when the result has no usage object", () => {
    const events = sampleEvents("plain");
    const result = copyOf(events[3]);
    delete result["usage"];

    expect(readStream([...events.slice(0, 3), result]).usage).toBe("unavailable");
  });
});
