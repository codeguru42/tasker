import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PI_ANSWER_TOOL_NAME } from "../../../src/assistant/pi/answer-tool.js";
import { piAnswer } from "../../../src/assistant/pi/answer.js";

type CheckedAnswer = { ok: true; answer: unknown } | { ok: false; problems: string[] };

function callPiAnswer(
  messages: readonly unknown[],
  checkAnswer: (output: unknown) => { ok: true } | { ok: false; problems: string[] } = () => ({ ok: true }),
): CheckedAnswer {
  const check = piAnswer as unknown as (
    messages: readonly unknown[],
    checkAnswer: (output: unknown) => { ok: true } | { ok: false; problems: string[] },
  ) => CheckedAnswer;
  return check(messages, checkAnswer);
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

    expect(callPiAnswer(messages)).toEqual({ ok: true, answer: { findings: [{ file: "last" }] } });
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

    expect(callPiAnswer(messages)).toEqual({ ok: true, answer: { answer: "accepted" } });
  });

  it("parses JSON from the whole assistant text", () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: '{"summary":"all text"}' }] }];

    expect(callPiAnswer(messages)).toEqual({ ok: true, answer: { summary: "all text" } });
  });

  it.each(["[1]", "5", '"x"'])("does not accept scalar or array assistant text %s", (text) => {
    const messages = [{ role: "assistant", content: [{ type: "text", text }] }];

    expect(callPiAnswer(messages)).toEqual({
      ok: false,
      problems: ["no accepted call of submit_answer and no JSON object in the final text"],
    });
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

    expect(callPiAnswer(messages)).toEqual({ ok: true, answer: { answer: "last" } });
  });

  it("uses the last untagged JSON fence when it holds an object", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: '```\n{"answer":"first"}\n``` then ```\n{"answer":"last"}\n```' }],
      },
    ];

    expect(callPiAnswer(messages)).toEqual({ ok: true, answer: { answer: "last" } });
  });

  it("uses the text when the accepted call fails the caller check", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: PI_ANSWER_TOOL_NAME, arguments: { answer: "call" } }],
      },
      { role: "toolResult", toolCallId: "c1", toolName: PI_ANSWER_TOOL_NAME, isError: false },
      { role: "assistant", content: [{ type: "text", text: '{"answer":"text"}' }] },
    ];
    const check = (output: unknown) =>
      (output as { answer: string }).answer === "text"
        ? { ok: true as const }
        : { ok: false as const, problems: ["answer: rejected"] };

    expect(callPiAnswer(messages, check)).toEqual({ ok: true, answer: { answer: "text" } });
  });

  it("returns prefixed problems in candidate order when neither candidate passes", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "c1", name: PI_ANSWER_TOOL_NAME, arguments: { answer: "call" } }],
      },
      { role: "toolResult", toolCallId: "c1", toolName: PI_ANSWER_TOOL_NAME, isError: false },
      { role: "assistant", content: [{ type: "text", text: '{"answer":"text"}' }] },
    ];
    const check = (output: unknown) => ({
      ok: false as const,
      problems: [`${(output as { answer: string }).answer}: rejected`],
    });

    expect(callPiAnswer(messages, check)).toEqual({
      ok: false,
      problems: ["submit_answer: call: rejected", "final text: text: rejected"],
    });
  });

  it("turns a thrown caller check into one problem", () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: '{"answer":"text"}' }] }];

    expect(
      callPiAnswer(messages, () => {
        throw new Error("bad check");
      }),
    ).toEqual({
      ok: false,
      problems: ["final text: the check of the answer threw: bad check"],
    });
  });

  it("keeps the object when an array follows it in JSON fences", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: '```json\n{"answer":"object"}\n```\n```json\n[1]\n```' }] },
    ];

    expect(callPiAnswer(messages)).toEqual({ ok: true, answer: { answer: "object" } });
  });

  it("keeps the object when it follows an array in JSON fences", () => {
    const messages = [
      { role: "assistant", content: [{ type: "text", text: '```json\n[1]\n```\n```json\n{"answer":"object"}\n```' }] },
    ];

    expect(callPiAnswer(messages)).toEqual({ ok: true, answer: { answer: "object" } });
  });

  it("prefers an accepted answer call over later assistant text", () => {
    const valid = measures.valid.stdout
      .filter((event) => event.type === "message_end")
      .map((event) => event.message)
      .filter((message) => message !== undefined);
    const messages = [...valid, { role: "assistant", content: [{ type: "text", text: '{"findings":["later"]}' }] }];

    expect(callPiAnswer(messages)).toEqual({ ok: true, answer: { findings: [] } });
  });
});
