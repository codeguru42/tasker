import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PI_ANSWER_TOOL_NAME } from "../../../src/assistant/pi/answer-tool.js";
import { piAnswer } from "../../../src/assistant/pi/answer.js";

function callPiAnswer(messages: readonly unknown[]): unknown {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return piAnswer(messages);
}

const measures = JSON.parse(
  readFileSync(new URL("../../fixtures/pi-streams/measures.json", import.meta.url), "utf8"),
) as Record<string, { stdout: { type: string; message?: unknown }[]; session: unknown[] }>;

describe("piAnswer", () => {
  it("returns the last accepted top-level submit_answer arguments", () => {
    const messages = [
      ...measures.twoCalls.session.slice(1).map((entry) => (entry as { message: unknown }).message),
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "c2", name: PI_ANSWER_TOOL_NAME, arguments: { findings: [{ file: "last" }] } },
        ],
      },
      { role: "toolResult", toolCallId: "c2", toolName: PI_ANSWER_TOOL_NAME, isError: false },
      { role: "assistant", content: [{ type: "text", text: "later plain text" }] },
    ];

    expect(callPiAnswer(messages)).toEqual({ findings: [{ file: "last" }] });
  });

  it("uses a submit_answer call only when its matching toolResult succeeded", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "bad", name: "submit_answer", arguments: { answer: "bad" } }],
      },
      { role: "toolResult", toolCallId: "bad", toolName: "submit_answer", isError: true },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "accepted",
            name: PI_ANSWER_TOOL_NAME,
            arguments: { answer: "accepted" },
            parentToolCallId: "outer",
          },
        ],
      },
      { role: "toolResult", toolCallId: "accepted", toolName: PI_ANSWER_TOOL_NAME, isError: false },
    ];

    expect(callPiAnswer(messages)).toEqual({ answer: "accepted" });
  });

  it("parses JSON from the whole assistant text", () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: '{"summary":"all text"}' }] }];

    expect(callPiAnswer(messages)).toEqual({ summary: "all text" });
  });

  it.each(["[1]", "5", '"x"'])("does not accept scalar or array assistant text %s", (text) => {
    const messages = [{ role: "assistant", content: [{ type: "text", text }] }];

    expect(callPiAnswer(messages)).toBeUndefined();
  });

  it("uses the last valid JSON fence", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: 'Earlier: ```json\n{"answer":"first"}\n``` Later: ```json\n{broken}\n``` Final: ```json\n{"answer":"last"}\n```',
          },
        ],
      },
    ];

    expect(callPiAnswer(messages)).toEqual({ answer: "last" });
  });

  it("keeps the object when an array follows it in JSON fences", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: '```json\n{"answer":"object"}\n```\n```json\n[1]\n```' }] },
    ];

    expect(callPiAnswer(messages)).toEqual({ answer: "object" });
  });

  it("keeps the object when it follows an array in JSON fences", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: '```json\n[1]\n```\n```json\n{"answer":"object"}\n```' }] },
    ];

    expect(callPiAnswer(messages)).toEqual({ answer: "object" });
  });

  it("prefers an accepted answer call over later assistant text", () => {
    const valid = measures.valid.session.slice(3).map((entry) => (entry as { message: unknown }).message);
    const messages = [...valid, { role: "assistant", content: [{ type: "text", text: '{"findings":["later"]}' }] }];

    expect(callPiAnswer(messages)).toEqual({ findings: [] });
  });
});
