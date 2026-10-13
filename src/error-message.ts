// The message of a thrown value: the message of an Error, else the value as a string.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
