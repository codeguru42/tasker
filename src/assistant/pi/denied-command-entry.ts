const WORD = /^[A-Za-z0-9._+-]+$/;

export function isDeniedCommandEntry(value: string): boolean {
  const words = value.split(" ");
  if (words.some((word) => word.length === 0 || word.startsWith("-") || !WORD.test(word))) return false;
  return words.length === 1 || (words.length === 2 && words[0] === "git");
}

export function invalidDeniedCommandEntries(values: readonly string[]): string[] {
  return values.filter((value) => !isDeniedCommandEntry(value));
}
