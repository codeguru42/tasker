// The first line of a program output, with one `\r` at its end removed. It does not trim.
export function firstLine(output: string): string {
  return output.split("\n")[0].replace(/\r$/, "");
}
