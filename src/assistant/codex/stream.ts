import { isObject } from "../../object.js";
import { numberOf } from "../event-line.js";
import type { AssistantEvent, TokenUsage, Usage } from "../provider.js";

export interface CodexStreamFacts {
  // Whether a turn.completed event came.
  completed: boolean;
  // The message of the last top-level error or turn.failed event. An item of type error is a warning and does not count.
  failureReason?: string;
  // The text of the last agent_message item.
  answerText?: string;
  usage: Usage;
}

const NO_MESSAGE = "the assistant ended with an error";

// The trimmed thread id of a thread.started event, or undefined when the id is empty after the trim.
export function threadIdOf(event: AssistantEvent): string | undefined {
  if (event.type !== "thread.started" || typeof event.thread_id !== "string") return undefined;
  const id = event.thread_id.trim();
  return id === "" ? undefined : id;
}

// The total of a turn.completed event. It is a total for the whole thread. input_tokens includes the cached
// tokens, and output_tokens includes the reasoning tokens. A bad field counts as 0.
export function usageTotalOf(event: AssistantEvent): TokenUsage | undefined {
  if (event.type !== "turn.completed" || !isObject(event.usage)) return undefined;
  const input = numberOf(event.usage.input_tokens) ?? 0;
  const cached = numberOf(event.usage.cached_input_tokens) ?? 0;
  return {
    inputTokens: Math.max(0, input - cached),
    outputTokens: numberOf(event.usage.output_tokens) ?? 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: cached,
  };
}

function failureMessageOf(event: AssistantEvent): string | undefined {
  if (event.type === "error") {
    return typeof event.message === "string" ? event.message : NO_MESSAGE;
  }
  if (event.type === "turn.failed") {
    return isObject(event.error) && typeof event.error.message === "string" ? event.error.message : NO_MESSAGE;
  }
  return undefined;
}

function answerOf(event: AssistantEvent): string | undefined {
  if (event.type !== "item.completed" || !isObject(event.item)) return undefined;
  return event.item.type === "agent_message" && typeof event.item.text === "string" ? event.item.text : undefined;
}

function minus(total: TokenUsage, previous: TokenUsage | undefined): TokenUsage {
  const take = (now: number, before: number | undefined) => Math.max(0, now - (before ?? 0));
  return {
    inputTokens: take(total.inputTokens, previous?.inputTokens),
    outputTokens: take(total.outputTokens, previous?.outputTokens),
    cacheCreationInputTokens: take(total.cacheCreationInputTokens, previous?.cacheCreationInputTokens),
    cacheReadInputTokens: take(total.cacheReadInputTokens, previous?.cacheReadInputTokens),
  };
}

// The facts of a run. The usage is the last total of the run minus the previous total of the thread.
export function readCodexStream(events: readonly AssistantEvent[], previous: TokenUsage | undefined): CodexStreamFacts {
  let completed = false;
  let failureReason: string | undefined;
  let answerText: string | undefined;
  let total: TokenUsage | undefined;
  for (const event of events) {
    if (event.type === "turn.completed") completed = true;
    total = usageTotalOf(event) ?? total;
    failureReason = failureMessageOf(event) ?? failureReason;
    answerText = answerOf(event) ?? answerText;
  }
  const facts: CodexStreamFacts = { completed, usage: total === undefined ? "unavailable" : minus(total, previous) };
  if (failureReason !== undefined) facts.failureReason = failureReason;
  if (answerText !== undefined) facts.answerText = answerText;
  return facts;
}
