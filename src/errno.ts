import { isObject } from "./object.js";

// The string code of an error from fs or a process, for example "ENOENT". It gives undefined for any other value.
export function errnoCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === "string" ? error.code : undefined;
}

// True when the string code of error is one of codes.
export function hasErrnoCode(error: unknown, codes: readonly string[]): boolean {
  const code = errnoCode(error);
  return code !== undefined && codes.includes(code);
}
