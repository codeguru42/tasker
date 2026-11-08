import { isObject } from "../object.js";
import type { AssistantEvent } from "./provider.js";

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

// Parses a line, appends its event, and protects the run from a broken event listener.
export function appendEventLine(
  line: string,
  events: AssistantEvent[],
  onEvent?: (event: AssistantEvent) => void,
): void {
  const event = parseLine(line);
  if (event === undefined) return;
  events.push(event);
  try {
    onEvent?.(event);
  } catch {
    // A broken event listener must not stop the run.
  }
}

// A number field of an event. A value that is not a finite number counts as missing.
export function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
