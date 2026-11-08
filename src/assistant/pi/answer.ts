import { isObject } from "../../object.js";
import { PI_ANSWER_TOOL_NAME } from "./answer-tool.js";

interface AnswerCall {
  id: string;
  arguments: unknown;
}

function answerCalls(message: Record<string, unknown>): AnswerCall[] {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content.flatMap((item): AnswerCall[] => {
    if (!isObject(item) || item.type !== "toolCall" || item.name !== PI_ANSWER_TOOL_NAME) return [];
    if (typeof item.id !== "string") return [];
    return [{ id: item.id, arguments: item.arguments }];
  });
}

function acceptedAnswer(messages: readonly unknown[]): unknown {
  const calls = new Map<string, unknown>();
  let answer: unknown;
  for (const message of messages) {
    if (!isObject(message)) continue;
    for (const call of answerCalls(message)) calls.set(call.id, call.arguments);
    if (
      message.role === "toolResult" &&
      message.toolName === PI_ANSWER_TOOL_NAME &&
      typeof message.toolCallId === "string" &&
      message.isError === false &&
      calls.has(message.toolCallId)
    ) {
      answer = calls.get(message.toolCallId);
    }
  }
  return answer;
}

function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function assistantText(messages: readonly unknown[]): string | undefined {
  const finalAssistant = messages.filter((message) => isObject(message) && message.role === "assistant").at(-1);
  if (!isObject(finalAssistant) || !Array.isArray(finalAssistant.content)) return undefined;
  const text = finalAssistant.content
    .flatMap((item) => (isObject(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : []))
    .join("");
  return text === "" ? undefined : text;
}

function lastJsonFence(text: string): unknown {
  const fences = /```(?:json)?\s*([\s\S]*?)```/giu;
  let answer: unknown;
  for (const match of text.matchAll(fences)) {
    const parsed = parseJson(match[1].trim());
    if (parsed !== undefined) answer = parsed;
  }
  return answer;
}

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export function piAnswer(messages: readonly unknown[]): unknown | undefined {
  const accepted = acceptedAnswer(messages);
  if (accepted !== undefined) return accepted;

  const text = assistantText(messages);
  if (text === undefined) return undefined;
  const wholeText = parseJson(text.trim());
  return wholeText === undefined ? lastJsonFence(text) : wholeText;
}
