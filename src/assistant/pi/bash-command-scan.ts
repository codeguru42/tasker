import type { BashCommand, ParsedBashLine } from "./bash-command-parse.js";

export interface ScanResult {
  matches: Set<string>;
  firstCause?: string;
}

export function scanBashCommands(parsed: ParsedBashLine, entries: string[]): ScanResult {
  const result: ScanResult = { matches: new Set<string>() };
  for (const command of parsed.commands) scanCommand(command, entries, result);
  return result;
}

function scanCommand(command: BashCommand, entries: string[], result: ScanResult): void {
  const words = command.words;
  let commandIndex = 0;
  while (commandIndex < words.length && isAssignment(words[commandIndex]?.value ?? "")) commandIndex += 1;
  while (commandIndex < words.length && isControlWord(words[commandIndex]?.value ?? "")) commandIndex += 1;

  const commandWord = words[commandIndex];
  const commandName = commandWord?.value ?? "";
  const base = basename(commandName);

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === undefined) continue;
    for (const nested of word.nested) scanCommand(nested, entries, result);
    const canChangeCommand = index === commandIndex || (base === "git" && index === commandIndex + 1);
    if (word.expanded && canChangeCommand)
      setFirstCause(result, "an expansion can change a command name or a word of a denied command");
  }

  if (commandWord === undefined || commandWord.expanded) return;
  for (const entry of entries) {
    if (entry.includes(" ")) {
      const [program, subcommand, extra] = entry.split(" ");
      if (extra === undefined && base === program && words[commandIndex + 1]?.value === subcommand) {
        result.matches.add(entry);
      }
      if (program === "git" && base.startsWith("git-") && base.slice(4) === subcommand) result.matches.add(entry);
    } else if (base === entry) {
      result.matches.add(entry);
    }
  }
}

function setFirstCause(result: ScanResult, cause: string): void {
  result.firstCause ??= cause;
}

function isAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])?=/.test(value);
}

function isControlWord(value: string): boolean {
  return ["then", "do", "else", "elif", "time", "!"].includes(value);
}

function basename(value: string): string {
  return value.split("/").at(-1) ?? value;
}
