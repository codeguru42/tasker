// The numbered rules of a filled or unfilled prompt, as the lines that start with a number and a dot.
export function rulesOf(prompt: string): string[] {
  return prompt.split("\n").filter((line) => /^\d+\. /.test(line));
}
