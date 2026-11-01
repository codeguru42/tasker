import { readFileSync } from "node:fs";
import { hasErrnoCode } from "../../errno.js";
import { isObject } from "../../object.js";
import { replaceFile } from "../../replace-file.js";
import { codexThreadIdPath, codexUsagePath } from "../../store/layout.js";
import { numberOf } from "../event-line.js";
import type { TokenUsage } from "../provider.js";

// The text of a file, or undefined when the file is missing. Another read error throws.
function textOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (hasErrnoCode(error, ["ENOENT"])) return undefined;
    throw error;
  }
}

// The thread id of a session. A missing file and an empty file give undefined. Another read error throws.
export function readThreadId(sessionDir: string, sessionId: string): string | undefined {
  const id = textOrUndefined(codexThreadIdPath(sessionDir, sessionId))?.trim();
  return id === undefined || id === "" ? undefined : id;
}

// Throws on a write error. The caller decides what a failed write means.
export function writeThreadId(sessionDir: string, sessionId: string, threadId: string): void {
  replaceFile(codexThreadIdPath(sessionDir, sessionId), threadId);
}

// The last usage total of a thread. A missing file, a read error and a bad text all give undefined,
// and the caller counts that as zero.
export function readUsageTotal(sessionDir: string, sessionId: string): TokenUsage | undefined {
  let value: unknown;
  try {
    const text = textOrUndefined(codexUsagePath(sessionDir, sessionId));
    if (text === undefined) return undefined;
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(value)) return undefined;
  const inputTokens = numberOf(value.inputTokens);
  const outputTokens = numberOf(value.outputTokens);
  const cacheCreationInputTokens = numberOf(value.cacheCreationInputTokens);
  const cacheReadInputTokens = numberOf(value.cacheReadInputTokens);
  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    cacheCreationInputTokens === undefined ||
    cacheReadInputTokens === undefined
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens };
}

// Throws on a write error. The caller decides what a failed write means.
export function writeUsageTotal(sessionDir: string, sessionId: string, total: TokenUsage): void {
  replaceFile(codexUsagePath(sessionDir, sessionId), JSON.stringify(total));
}
