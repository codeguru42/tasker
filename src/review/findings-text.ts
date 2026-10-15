import { indented } from "../indented.js";
import type { Finding } from "./answer.js";

export interface FindingEntry {
  position: number; // the place of the finding in its review, from 1
  finding: Finding;
  dismissed: { at: string; reason: string } | null;
}

// The text form of a list of findings. Each command that prints findings uses it.
export function formatFindings(entries: readonly FindingEntry[]): string {
  if (entries.length === 0) return "no findings\n";
  return entries
    .map(({ position, finding, dismissed }) => {
      const place = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
      const category = finding.category === undefined ? "" : ` (${finding.category})`;
      const status = dismissed === null ? "open" : `dismissed: ${dismissed.reason}`;
      const firstLine = `[${position}] ${place}${category}: ${finding.summary}`;
      // A line end in the first line keeps the indent of the block. The "- " takes the place of the first indent.
      return (
        `- ${indented("  ", firstLine).slice(2)}\n` +
        `${indented("  ", `failure scenario: ${finding.failure_scenario}`)}\n` +
        `${indented("  ", `status: ${status}`)}\n`
      );
    })
    .join("");
}
