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

// A number field of an event. A value that is not a finite number counts as missing.
export function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
