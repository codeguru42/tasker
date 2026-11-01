import { describe, expect, it } from "vitest";
import { readCodexStream, threadIdOf, usageTotalOf } from "../../../src/assistant/codex/stream.js";
import type { AssistantEvent } from "../../../src/assistant/provider.js";
import { CODEX_PLAIN_USAGE, CODEX_RESUME_USAGE, codexSampleEvents } from "../../helpers/fake-codex.js";

const NO_MESSAGE = "the assistant ended with an error";

function withoutType(events: AssistantEvent[], type: string): AssistantEvent[] {
  return events.filter((event) => event.type !== type);
}

describe("threadIdOf", () => {
  it("gives the thread id of thread.started", () => {
    expect(threadIdOf(codexSampleEvents("plain")[0])).toBe("01a194bc-1d2f-77b2-a52d-5be299f7ea30");
  });

  it("gives undefined for each other event", () => {
    for (const event of codexSampleEvents("plain").slice(1)) expect(threadIdOf(event)).toBeUndefined();
  });

  it("gives undefined when thread_id is not a string", () => {
    expect(threadIdOf({ type: "thread.started", thread_id: 3 })).toBeUndefined();
  });
});

describe("usageTotalOf", () => {
  it("gives the total of a turn.completed event, with the cached tokens apart", () => {
    expect(usageTotalOf(codexSampleEvents("plain")[3])).toEqual(CODEX_PLAIN_USAGE);
  });

  it("gives undefined for another event", () => {
    expect(usageTotalOf(codexSampleEvents("plain")[0])).toBeUndefined();
  });
});

describe("readCodexStream completion and failure", () => {
  it("is completed with a turn.completed event", () => {
    expect(readCodexStream(codexSampleEvents("plain"), undefined).completed).toBe(true);
  });

  it("is not completed without a turn.completed event", () => {
    const events = withoutType(codexSampleEvents("plain"), "turn.completed");

    expect(readCodexStream(events, undefined).completed).toBe(false);
  });

  it("gives the message of turn.failed as the failure reason", () => {
    const events = codexSampleEvents("turn-failed");
    const failed = events.find((event) => event.type === "turn.failed")!;

    expect(readCodexStream(events, undefined).failureReason).toBe((failed.error as { message: string }).message);
  });

  it("lets the last failure event win", () => {
    const events: AssistantEvent[] = [
      { type: "error", message: "first" },
      { type: "turn.failed", error: { message: "second" } },
    ];

    expect(readCodexStream(events, undefined).failureReason).toBe("second");
  });

  it("gives a fixed reason for a failure event with no message", () => {
    expect(readCodexStream([{ type: "turn.failed" }], undefined).failureReason).toBe(NO_MESSAGE);
    expect(readCodexStream([{ type: "error" }], undefined).failureReason).toBe(NO_MESSAGE);
  });

  it("is completed with no failure reason for the stream of a run with the hook trust flag", () => {
    const facts = readCodexStream(codexSampleEvents("hook-flag"), undefined);

    expect(facts.failureReason).toBeUndefined();
    expect(facts.completed).toBe(true);
    expect(facts.answerText).toBe("DONE");
  });

  it("gives no failure reason for a warning item of type error", () => {
    const events: AssistantEvent[] = [
      { type: "item.completed", item: { id: "item_0", type: "error", message: "model mismatch" } },
      ...codexSampleEvents("plain"),
    ];

    const facts = readCodexStream(events, undefined);

    expect(facts.failureReason).toBeUndefined();
    expect(facts.completed).toBe(true);
  });
});

describe("readCodexStream answer", () => {
  it("takes the text of the last agent_message", () => {
    expect(readCodexStream(codexSampleEvents("command"), undefined).answerText).toBe("hello");
  });

  it("gives no answer text without an agent_message", () => {
    expect(
      readCodexStream(withoutType(codexSampleEvents("plain"), "item.completed"), undefined).answerText,
    ).toBeUndefined();
  });
});

describe("readCodexStream usage", () => {
  it("gives the whole total with no previous total", () => {
    expect(readCodexStream(codexSampleEvents("plain"), undefined).usage).toEqual(CODEX_PLAIN_USAGE);
  });

  it("subtracts the previous total", () => {
    expect(readCodexStream(codexSampleEvents("resume"), CODEX_PLAIN_USAGE).usage).toEqual(CODEX_RESUME_USAGE);
  });

  it("uses the last of two turn.completed events", () => {
    const events = [...codexSampleEvents("plain"), ...codexSampleEvents("resume")];

    expect(readCodexStream(events, CODEX_PLAIN_USAGE).usage).toEqual(CODEX_RESUME_USAGE);
  });

  it("never gives a negative count", () => {
    const previous = { ...CODEX_PLAIN_USAGE, inputTokens: 999_999, outputTokens: 999_999 };

    expect(readCodexStream(codexSampleEvents("plain"), previous).usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it("counts a bad field as 0", () => {
    const events: AssistantEvent[] = [
      { type: "turn.completed", usage: { input_tokens: "x", cached_input_tokens: null, output_tokens: 5 } },
    ];

    expect(readCodexStream(events, undefined).usage).toEqual({
      inputTokens: 0,
      outputTokens: 5,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it("is unavailable without a turn.completed event", () => {
    const events = withoutType(codexSampleEvents("plain"), "turn.completed");

    expect(readCodexStream(events, undefined).usage).toBe("unavailable");
  });
});
