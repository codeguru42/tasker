import { parseBashCommand, type BashCommand, type BashWord, type ParsedBashLine } from "./bash-command-parse.js";

const CAUSE = {
  expansion: "an expansion can change a command name or a word of a denied command",
  input: "a shell or source reads commands that the guard extension cannot see",
  binding: "a command can bind a name to another program",
  option: "an unknown option of git or of a shell",
  array: "an array index can run a command",
  depth: "the command lines are nested more than 8 levels deep",
};

const SHELLS = ["bash", "sh"] as const;
const LINE_READERS = ["bash", "sh", "eval"] as const;
const BINDING_COMMANDS = ["alias", "fc", "trap"] as const;
const BINDING_ASSIGNMENTS = ["BASH_ENV", "ENV"] as const;
const MAX_COMMAND_DEPTH = 8;

export interface ScanResult {
  matches: Set<string>;
  firstCause?: string;
}

export function scanBashCommands(parsed: ParsedBashLine, entries: string[]): ScanResult {
  const result: ScanResult = { matches: new Set<string>() };
  for (const command of parsed.commands) scanCommand(command, entries, result, 1);
  return result;
}

function scanCommand(command: BashCommand, entries: string[], result: ScanResult, depth: number): void {
  const words = command.words;
  let commandIndex = 0;
  while (commandIndex < words.length && isAssignment(words[commandIndex]?.value ?? "")) commandIndex += 1;
  while (commandIndex < words.length && isControlWord(words[commandIndex]?.value ?? "")) commandIndex += 1;

  const commandWord = words[commandIndex];
  const base = basename(commandWord?.value ?? "");

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === undefined) continue;
    scanNested(word, entries, result, depth);
    if (isArrayAssignment(word.value) || (base === "let" && hasExecutableArrayIndex(word.value))) {
      setFirstCause(result, CAUSE.array);
    }
    if (isSpecialAssignment(word.value)) setFirstCause(result, CAUSE.binding);
    const canChangeCommand =
      index === commandIndex ||
      (base === "git" && index === commandIndex + 1) ||
      (isShell(base) && index > commandIndex) ||
      (isSourceCommand(base) && index === commandIndex + 1);
    if (word.expanded && canChangeCommand && !isAssignment(word.value)) setFirstCause(result, CAUSE.expansion);
  }

  if (commandWord === undefined || commandWord.expanded) return;
  addDirectMatches(base, commandIndex, words, entries, result);
  if (isBindingCommand(base, words.slice(commandIndex + 1))) setFirstCause(result, CAUSE.binding);
  if (isLineReader(base)) scanLineReader(base, words, commandIndex, entries, result, depth);
  if (isSourceCommand(base)) scanSource(words, commandIndex, result);
  if (command.inputFromPipeline && isShell(base)) setFirstCause(result, CAUSE.input);
  if (isShell(base) && shellReadsInput(words, commandIndex)) setFirstCause(result, CAUSE.input);
  if (base === "fish") setFirstCause(result, CAUSE.option);
}

function scanNested(word: BashWord, entries: string[], result: ScanResult, depth: number): void {
  for (const nested of word.nested) scanCommand(nested, entries, result, depth);
}

function addDirectMatches(
  base: string,
  commandIndex: number,
  words: BashWord[],
  entries: string[],
  result: ScanResult,
): void {
  for (const entry of entries) {
    const parts = entry.split(" ");
    if (parts.length === 1 && base === entry) result.matches.add(entry);
    if (parts.length === 2) {
      const [program, subcommand] = parts;
      if (base === program && words[commandIndex + 1]?.value === subcommand) result.matches.add(entry);
      if (program === "git" && base.startsWith("git-") && base.slice(4) === subcommand) result.matches.add(entry);
    }
  }
}

function scanLineReader(
  base: string,
  words: BashWord[],
  commandIndex: number,
  entries: string[],
  result: ScanResult,
  depth: number,
): void {
  if (base === "eval") {
    const codeWords = words.slice(commandIndex + 1);
    if (codeWords.some((word) => word.expanded)) {
      setFirstCause(result, CAUSE.expansion);
      return;
    }
    const code = codeWords.map((word) => word.value).join(" ");
    if (code.length > 0) scanReparsed(code, entries, result, depth);
    return;
  }

  const parsedOptions = parseShellOptions(base, words, commandIndex + 1);
  if (parsedOptions.unknown) {
    setFirstCause(result, CAUSE.option);
    return;
  }
  if (parsedOptions.readsStdin) {
    setFirstCause(result, CAUSE.input);
    return;
  }
  if (parsedOptions.commandIndex !== undefined) {
    const code = words[parsedOptions.commandIndex];
    if (code === undefined) {
      setFirstCause(result, CAUSE.input);
    } else if (code.expanded) {
      setFirstCause(result, CAUSE.expansion);
    } else {
      scanReparsed(code.value, entries, result, depth);
    }
  }
}

interface ShellOptions {
  unknown: boolean;
  readsStdin: boolean;
  commandIndex?: number;
}

function parseShellOptions(base: string, words: BashWord[], start: number): ShellOptions {
  let index = start;
  let commandMode = false;
  while (index < words.length) {
    const value = words[index]?.value ?? "";
    if (value === "--") {
      index += 1;
      break;
    }
    if (value === "-") return { unknown: false, readsStdin: true };
    if (!value.startsWith("-")) break;
    for (const flag of value.slice(1)) {
      if (flag === "c") commandMode = true;
      else if (flag === "s") return { unknown: false, readsStdin: true };
      else if (flag === "o" || flag === "O") {
        index += 1;
        if (words[index] === undefined) return { unknown: true, readsStdin: false };
      } else if (
        (base === "bash" && "abefhklmnptuvxBCEHPT".includes(flag)) ||
        (base === "sh" && "abefnuvx".includes(flag))
      ) {
        continue;
      } else {
        return { unknown: true, readsStdin: false };
      }
    }
    index += 1;
  }
  if (commandMode) return { unknown: false, readsStdin: false, commandIndex: index };
  if (base === "bash" && words.slice(index).some((word) => normalizePath(word.value) === "dev/stdin")) {
    return { unknown: false, readsStdin: true };
  }
  return { unknown: false, readsStdin: false };
}

function scanReparsed(code: string, entries: string[], result: ScanResult, depth: number): void {
  const nextDepth = depth + 1;
  if (nextDepth > MAX_COMMAND_DEPTH) {
    setFirstCause(result, CAUSE.depth);
    return;
  }
  const parsed = parseBashCommand(code);
  for (const command of parsed.commands) scanCommand(command, entries, result, nextDepth);
}

function scanSource(words: BashWord[], commandIndex: number, result: ScanResult): void {
  const source = words[commandIndex + 1];
  if (source === undefined) setFirstCause(result, CAUSE.input);
  else if (source.expanded) setFirstCause(result, CAUSE.expansion);
  else setFirstCause(result, CAUSE.input);
}

function shellReadsInput(words: BashWord[], commandIndex: number): boolean {
  return words.slice(commandIndex + 1).some((word) => {
    const value = word.value;
    return value === "<" || value === "<<<" || value === "<<" || normalizePath(value) === "dev/stdin";
  });
}

function isSourceCommand(base: string): boolean {
  return base === "." || base === "source";
}

function isBindingCommand(base: string, args: BashWord[]): boolean {
  return (
    BINDING_COMMANDS.includes(base as (typeof BINDING_COMMANDS)[number]) || (base === "hash" && args[0]?.value === "-p")
  );
}

function isSpecialAssignment(value: string): boolean {
  const equals = value.indexOf("=");
  if (equals < 0) return false;
  const name = value.slice(0, equals);
  return BINDING_ASSIGNMENTS.includes(name as (typeof BINDING_ASSIGNMENTS)[number]) || name.startsWith("BASH_CMDS[");
}

function isArrayAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*\[.*\]=/.test(value) && hasExecutableArrayIndex(value);
}

function hasExecutableArrayIndex(value: string): boolean {
  const open = value.indexOf("[");
  const close = value.indexOf("]");
  return open >= 0 && close > open && value.slice(open + 1, close).includes("$(");
}

function isAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\[.*\])?=/.test(value);
}

function isControlWord(value: string): boolean {
  return ["then", "do", "else", "elif", "time", "!"].includes(value);
}

function basename(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function normalizePath(value: string): string {
  return value
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .join("/");
}

function isShell(base: string): boolean {
  return SHELLS.includes(base as (typeof SHELLS)[number]);
}

function isLineReader(base: string): boolean {
  return LINE_READERS.includes(base as (typeof LINE_READERS)[number]);
}

function setFirstCause(result: ScanResult, cause: string): void {
  result.firstCause ??= cause;
}
