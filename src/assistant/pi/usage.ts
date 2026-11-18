import { numberOf } from "../event-line.js";
import { isObject } from "../../object.js";
import type { AssistantEvent, TokenUsage, Usage } from "../provider.js";

// The four counters of a pi usage value. A value with a bad field, or with four counters of 0, gives undefined.
function usageValueOf(value: unknown): TokenUsage | undefined {
  if (!isObject(value)) return undefined;
  const inputTokens = numberOf(value.input);
  const outputTokens = numberOf(value.output);
  const cacheCreationInputTokens = numberOf(value.cacheWrite);
  const cacheReadInputTokens = numberOf(value.cacheRead);
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    cacheCreationInputTokens === undefined ||
    cacheReadInputTokens === undefined
  ) {
    return undefined;
  }
  const counters = [inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens];
  if (counters.some((counter) => counter < 0) || counters.every((counter) => counter === 0)) return undefined;
  return { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens };
}

export function addUsage(a: Usage, b: Usage): Usage {
  if (a === "unavailable") return b;
  if (b === "unavailable") return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

interface Counted {
  value: TokenUsage;
  stdout: number;
  session: number;
}

interface MessageValue {
  key: string;
  value: TokenUsage;
  assistant: boolean;
  timestamp: unknown;
}

function messageValue(message: unknown): MessageValue | undefined {
  if (!isObject(message) || (message.role !== "assistant" && message.role !== "toolResult")) return undefined;
  const value = usageValueOf(message.usage);
  if (value === undefined) return undefined;
  const key = JSON.stringify([
    "message",
    message.role,
    message.timestamp,
    value.inputTokens,
    value.outputTokens,
    value.cacheCreationInputTokens,
    value.cacheReadInputTokens,
  ]);
  return { key, value, assistant: message.role === "assistant", timestamp: message.timestamp };
}

// The usage that one pi process added: its stdout events and the session-file entries that it added.
// A value that both sources hold counts once. Equal values inside one source count as often as they show.
// An assistant message with no message_end counts with its last message_update, unless a final assistant
// value of either source has the same timestamp.
export function piProcessUsage(events: readonly AssistantEvent[], sessionEntries: readonly unknown[]): Usage {
  const counted = new Map<string, Counted>();
  const finalTimestamps = new Set<unknown>();
  const partials: { timestamp: unknown; value: TokenUsage }[] = [];
  let open: { timestamp: unknown; last: TokenUsage | undefined } | undefined;
  const closeOpen = (): void => {
    if (open?.last !== undefined) partials.push({ timestamp: open.timestamp, value: open.last });
    open = undefined;
  };
  const count = (source: "stdout" | "session", found: MessageValue | undefined): void => {
    if (found === undefined) return;
    if (found.assistant) finalTimestamps.add(found.timestamp);
    const entry = counted.get(found.key) ?? { value: found.value, stdout: 0, session: 0 };
    entry[source] += 1;
    counted.set(found.key, entry);
  };

  for (const event of events) {
    const role = isObject(event.message) ? event.message.role : undefined;
    if (event.type === "message_start" && role === "assistant") {
      closeOpen();
      open = { timestamp: (event.message as Record<string, unknown>).timestamp, last: undefined };
    } else if (event.type === "message_update" && open !== undefined) {
      open.last = usageValueOf(event.usage) ?? open.last;
    } else if (event.type === "message_end") {
      if (role === "assistant") open = undefined;
      count("stdout", messageValue(event.message));
    }
  }
  closeOpen();
  for (const entry of sessionEntries) {
    if (isObject(entry) && entry.type === "message") count("session", messageValue(entry.message));
  }

  let total: Usage = "unavailable";
  for (const partial of partials) {
    if (!finalTimestamps.has(partial.timestamp)) total = addUsage(total, partial.value);
  }
  for (const entry of counted.values()) {
    const times = Math.max(entry.stdout, entry.session);
    for (let index = 0; index < times; index += 1) total = addUsage(total, entry.value);
  }
  return total;
}
