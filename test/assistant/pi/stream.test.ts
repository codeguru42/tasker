import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { piMessages } from "../../../src/assistant/pi/stream.js";
import type { AssistantEvent } from "../../../src/assistant/provider.js";
import { useTempDir } from "../../helpers/temp.js";

let maxReadSize = Number.POSITIVE_INFINITY;

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readSync: vi.fn((fd: number, buffer: Buffer, offset: number, length: number, position: number) =>
      actual.readSync(fd, buffer, offset, Math.min(length, maxReadSize), position),
    ) as unknown as typeof actual.readSync,
  };
});

function callPiMessages(events: readonly AssistantEvent[], sessionPath: string, startSize: number): unknown[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return piMessages(events, sessionPath, startSize);
}

const measures = JSON.parse(
  readFileSync(new URL("../../fixtures/pi-streams/measures.json", import.meta.url), "utf8"),
) as Record<string, { stdout: AssistantEvent[]; session: unknown[] }>;

function writeSession(entries: readonly unknown[]): { path: string; size: number } {
  const path = join(useTempDir("tasker-pi-stream-"), "session.jsonl");
  const text = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  writeFileSync(path, text);
  return { path, size: Buffer.byteLength(text) };
}

describe("piMessages", () => {
  it("keeps message_end messages in stream order", () => {
    const events = measures.text.stdout;

    expect(callPiMessages(events, "unused", 0)).toEqual(
      events.filter((event) => event.type === "message_end").map((event) => event.message),
    );
  });

  it("uses only session bytes after startSize when no agent_end event exists", () => {
    const oldAnswer = {
      type: "message",
      message: { role: "assistant", content: [{ type: "text", text: "old answer" }] },
    };
    const oldError = {
      type: "message",
      message: { role: "assistant", stopReason: "error", errorMessage: "old error" },
    };
    const appended = [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "new prompt" }] } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "new answer" }] } },
    ];
    const session = writeSession([oldAnswer, oldError]);
    writeFileSync(session.path, appended.map((entry) => `${JSON.stringify(entry)}\n`).join(""), { flag: "a" });

    expect(callPiMessages([], session.path, session.size)).toEqual(appended.map((entry) => entry.message));
  });

  it("reads all appended messages when readSync returns short chunks", () => {
    const appended = [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "new prompt" }] } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "new answer" }] } },
    ];
    const session = writeSession([
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "old answer" }] } },
    ]);
    writeFileSync(session.path, appended.map((entry) => `${JSON.stringify(entry)}\n`).join(""), { flag: "a" });

    maxReadSize = 7;
    try {
      expect(callPiMessages([], session.path, session.size)).toEqual(appended.map((entry) => entry.message));
    } finally {
      maxReadSize = Number.POSITIVE_INFINITY;
    }
  });

  it("returns no fallback messages when the session path is undefined", () => {
    expect(callPiMessages([], undefined as unknown as string, 0)).toEqual([]);
  });

  it("returns no fallback messages when the session file is missing", () => {
    const missingPath = join(useTempDir("tasker-pi-stream-"), "missing.jsonl");

    expect(callPiMessages([], missingPath, 0)).toEqual([]);
  });

  it("returns no fallback messages when the session file is shorter than startSize", () => {
    const session = writeSession([
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "answer" }] } },
    ]);

    expect(callPiMessages([], session.path, session.size + 1)).toEqual([]);
  });

  it("skips a partial JSONL line at startSize and reads later complete lines", () => {
    const earlier = { type: "message", message: { role: "assistant", content: [{ type: "text", text: "old" }] } };
    const partial = { type: "message", message: { role: "assistant", content: [{ type: "text", text: "partial" }] } };
    const later = { type: "message", message: { role: "assistant", content: [{ type: "text", text: "later" }] } };
    const session = writeSession([earlier]);
    const partialLine = `${JSON.stringify(partial)}\n`;
    const startSize = session.size + Math.floor(partialLine.length / 2);
    writeFileSync(session.path, `${partialLine}${JSON.stringify(later)}\n`, { flag: "a" });

    expect(callPiMessages([], session.path, startSize)).toEqual([later.message]);
  });

  it("uses the stream when agent_end exists, even if the session has newer entries", () => {
    const session = writeSession([
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "session answer" }] } },
    ]);

    expect(callPiMessages(measures.text.stdout, session.path, 0)).toEqual(
      measures.text.stdout.filter((event) => event.type === "message_end").map((event) => event.message),
    );
  });

  it("keeps the final assistant message after retries", () => {
    const messages = callPiMessages(measures.failedRetry.stdout, "unused", 0) as Record<string, unknown>[];
    const lastAssistant = messages.filter((message) => message.role === "assistant").at(-1);

    expect(lastAssistant).toMatchObject({ stopReason: "error", errorMessage: "429 rate limit exceeded, overloaded" });
  });
});
