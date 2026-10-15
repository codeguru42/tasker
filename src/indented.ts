// The text with the prefix before each of its lines. Each line end of the text counts.
export function indented(prefix: string, text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
