import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isObject } from "../../object.js";
import type { AssistantEvent } from "../provider.js";

export function piMessages(
  events: readonly AssistantEvent[],
  sessionPath: string | undefined,
  startSize: number,
): unknown[] {
  if (events.some((event) => event.type === "agent_end")) {
    return events.flatMap((event) =>
      event.type === "message_end" && event.message !== undefined ? [event.message] : [],
    );
  }

  if (sessionPath === undefined) return [];

  let appended: Buffer;
  let fd: number | undefined;
  try {
    fd = openSync(sessionPath, "r");
    const size = fstatSync(fd).size;
    if (size < startSize) return [];
    appended = Buffer.alloc(size - startSize);
    let bytesRead = 0;
    while (bytesRead < appended.length) {
      const count = readSync(fd, appended, bytesRead, appended.length - bytesRead, startSize + bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
    appended = appended.subarray(0, bytesRead);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return appended
    .toString("utf8")
    .split("\n")
    .flatMap((line) => {
      if (line === "") return [];
      try {
        const entry: unknown = JSON.parse(line);
        return isObject(entry) && entry.type === "message" && entry.message !== undefined ? [entry.message] : [];
      } catch {
        return [];
      }
    });
}
