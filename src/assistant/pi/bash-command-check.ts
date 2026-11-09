import { BashParseError, parseBashCommand } from "./bash-command-parse.js";
import { scanBashCommands } from "./bash-command-scan.js";

const PARSE_CAUSE = "the line does not parse";
const EXPANSION_CAUSE = "an expansion can change a command name or a word of a denied command";

export function checkBashCommand(command: string, entries: string[]): string | null {
  try {
    const parsed = parseBashCommand(command);
    const scanned = scanBashCommands(parsed, entries);
    for (const entry of entries) {
      if (scanned.matches.has(entry)) {
        return `tasker blocked this command: it runs "${entry}", which this run must not run.`;
      }
    }
    if (scanned.firstCause !== undefined) return causeReason(scanned.firstCause);
    return null;
  } catch (error) {
    if (error instanceof BashParseError) return causeReason(PARSE_CAUSE);
    return causeReason("an error in the guard extension");
  }
}

function causeReason(cause: string): string {
  const detail = cause === PARSE_CAUSE ? PARSE_CAUSE : cause === EXPANSION_CAUSE ? EXPANSION_CAUSE : cause;
  return `tasker blocked this command: the guard extension cannot read it with certainty (${detail}).`;
}
