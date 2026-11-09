import { BashParseError, parseBashCommand } from "./bash-command-parse.js";
import { scanBashCommands } from "./bash-command-scan.js";

const PARSE_CAUSE = "the line does not parse";
export type BashCommandCheck = { block: false } | { block: true; reason: string };

export function checkBashCommand(command: string, entries: readonly string[]): BashCommandCheck {
  try {
    const parsed = parseBashCommand(command);
    const scanned = scanBashCommands(parsed, entries);
    for (const entry of entries) {
      if (scanned.matches.has(entry)) {
        return { block: true, reason: `tasker blocked this command: it runs "${entry}", which this run must not run.` };
      }
    }
    if (parsed.parseError !== undefined) return { block: true, reason: reasonForCause(PARSE_CAUSE) };
    if (scanned.firstCause !== undefined) return { block: true, reason: reasonForCause(scanned.firstCause) };
    return { block: false };
  } catch (error) {
    if (error instanceof BashParseError) return { block: true, reason: reasonForCause(PARSE_CAUSE) };
    return { block: true, reason: reasonForCause("an error in the guard extension") };
  }
}

function reasonForCause(cause: string): string {
  return `tasker blocked this command: the guard extension cannot read it with certainty (${cause}).`;
}
