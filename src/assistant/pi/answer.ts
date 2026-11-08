import { isObject } from "../../object.js";
import { errorMessage } from "../../error-message.js";
import { PI_ANSWER_TOOL_NAME } from "./answer-tool.js";
import type { AnswerCheck } from "../provider.js";

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

function acceptedAnswer(messages: readonly unknown[]): { found: boolean; answer: unknown } {
  const calls = new Map<string, unknown>();
  let answer: { found: boolean; answer: unknown } = { found: false, answer: undefined };
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
      answer = { found: true, answer: calls.get(message.toolCallId) };
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

type PiAnswerResult = { ok: true; answer: unknown } | { ok: false; problems: string[] };

export function piAnswer(messages: readonly unknown[], checkAnswer: (output: unknown) => AnswerCheck): PiAnswerResult {
  const problems: string[] = [];
  const checkCandidate = (source: "submit_answer" | "final text", candidate: unknown): PiAnswerResult | undefined => {
    try {
      const checked = checkAnswer(candidate);
      if (checked.ok) return { ok: true, answer: candidate };
      problems.push(...checked.problems.map((problem) => `${source}: ${problem}`));
    } catch (error) {
      problems.push(`${source}: the check of the answer threw: ${errorMessage(error)}`);
    }
    return undefined;
  };

  const accepted = acceptedAnswer(messages);
  if (accepted.found) {
    const checked = checkCandidate("submit_answer", accepted.answer);
    if (checked !== undefined) return checked;
  }

  const text = assistantText(messages);
  if (text !== undefined) {
    const wholeText = parseJson(text.trim());
    const candidate = wholeText === undefined ? lastJsonFence(text) : wholeText;
    if (candidate !== undefined) {
      const checked = checkCandidate("final text", candidate);
      if (checked !== undefined) return checked;
    }
  }

  if (problems.length === 0) {
    problems.push("no accepted call of submit_answer and no JSON object in the final text");
  }
  return { ok: false, problems };
}
