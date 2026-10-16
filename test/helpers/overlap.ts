// One part of the overlap warning that a test expects: another task and its shared files, in the order of the warning.
export interface ExpectedOverlap {
  issueKey: string;
  state: string;
  files: readonly string[];
}

// The text of the overlap warning that a test expects on stderr: the two fixed lines, then for each entry the line
// "  <issue key> (<state>):" and one line "    <file>" for each of its files, then each line of lastLines. Each line
// ends with a line end. The fixed lines are literal text, so a change of the text in src/ makes the tests fail.
export function overlapWarningText(entries: readonly ExpectedOverlap[], lastLines: readonly string[]): string {
  const lines = [
    "WARNING: this plan changes files that other tasks in flight also change.",
    "The task that lands second can get merge conflicts and redo its work.",
    ...entries.flatMap((entry) => [
      `  ${entry.issueKey} (${entry.state}):`,
      ...entry.files.map((file) => `    ${file}`),
    ]),
    ...lastLines,
  ];
  return `${lines.join("\n")}\n`;
}
