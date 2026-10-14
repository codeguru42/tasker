import { isObject } from "../../object.js";
import type { AssistantEvent, PermissionDenial, Usage } from "../provider.js";

export interface StreamFacts {
  result?: Record<string, unknown>;
  permissionDenials: PermissionDenial[];
  reportedModel?: string;
  usage: Usage;
}

// One line of stdout as an event. A line that is empty, cut or not an object gives undefined.
export function parseLine(line: string): AssistantEvent | undefined {
  if (line === "") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  return isObject(value) ? value : undefined;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function denialsOf(result: Record<string, unknown> | undefined): PermissionDenial[] {
  const items = result?.["permission_denials"];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) =>
    isObject(item) && typeof item["tool_name"] === "string"
      ? [{ tool: item["tool_name"], input: item["tool_input"] }]
      : [],
  );
}

// The model of the first message of the main thread. init keeps the suffix, for example [1m], that messages drop.
function reportedModelOf(events: readonly AssistantEvent[]): string | undefined {
  let messageModel: string | undefined;
  for (const event of events) {
    if (event["type"] !== "assistant" || event["parent_tool_use_id"] !== null) continue;
    const model = isObject(event["message"]) ? event["message"]["model"] : undefined;
    if (typeof model === "string" && model !== "<synthetic>") {
      messageModel = model;
      break;
    }
  }
  if (messageModel === undefined) return undefined;
  const init = events.find((event) => event["type"] === "system" && event["subtype"] === "init" && typeof event["model"] === "string");
  const initModel = init?.["model"] as string | undefined;
  if (initModel?.startsWith(messageModel) && /^\[[^[\]]+\]$/.test(initModel.slice(messageModel.length))) {
    return initModel;
  }
  return messageModel;
}

// Only the result event gives exact totals, because claude splits one API message into several assistant events.
function usageOf(result: Record<string, unknown> | undefined): Usage {
  const usage = result?.["usage"];
  if (!isObject(usage)) return "unavailable";
  return {
    inputTokens: count(usage["input_tokens"]),
    outputTokens: count(usage["output_tokens"]),
    cacheCreationInputTokens: count(usage["cache_creation_input_tokens"]),
    cacheReadInputTokens: count(usage["cache_read_input_tokens"]),
  };
}

export function readStream(events: readonly AssistantEvent[]): StreamFacts {
  const last = events.at(-1);
  const result = last?.["type"] === "result" ? last : undefined;
  const facts: StreamFacts = {
    permissionDenials: denialsOf(result),
    usage: usageOf(result),
  };
  if (result !== undefined) facts.result = result;
  const reportedModel = reportedModelOf(events);
  if (reportedModel !== undefined) facts.reportedModel = reportedModel;
  return facts;
}
