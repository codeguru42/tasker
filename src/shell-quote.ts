// A text in single quotes for a shell script. Each ' in the text becomes '\''.
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}
