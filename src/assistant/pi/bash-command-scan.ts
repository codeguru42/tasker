import { parseBashCommand, type BashCommand, type BashWord, type ParsedBashLine } from "./bash-command-parse.js";
import {
  hasBindingEffect,
  isHiddenShellInput,
  isShell,
  isSpecialAssignment,
  isWrapper,
  readerActions,
  READER_CAUSES,
  shellRead,
  wrapperTarget,
} from "./bash-command-readers.js";
import { gitSubcommandIndex, scanGit } from "./bash-command-git.js";
import { scanFind } from "./bash-command-find.js";
import {
  COMMAND_TEXT_ASSIGNMENTS,
  GIT_COMMAND_ASSIGNMENT_PREFIX,
  XARGS_SAFE_COMMANDS,
  XARGS_SAFE_MODES,
  XARGS_SAFE_OPTIONS,
  XARGS_VALUE_OPTIONS,
} from "./bash-command-tables.js";

const CAUSE = {
  expansion: "an expansion can change a command name or a word of a denied command",
  input: "a shell or source reads commands that the guard extension cannot see",
  binding: "a command can bind a name to another program",
  option: "an unknown option of git or of a shell",
  array: "an array index can run a command",
  gitConfig: "git can run a command line from a configuration value",
  depth: "the command lines are nested more than 8 levels deep",
};

const MAX_COMMAND_DEPTH = 8;

export interface ScanResult {
  matches: Set<string>;
  firstCause?: string;
}

export function scanBashCommands(parsed: ParsedBashLine, entries: readonly string[]): ScanResult {
  const result: ScanResult = { matches: new Set<string>() };
  for (const command of parsed.commands) scanCommand(command, entries, result, 1);
  return result;
}

function scanCommand(command: BashCommand, entries: readonly string[], result: ScanResult, depth: number): void {
  const allWords = command.words;
  const words = allWords.filter((word) => !word.redirectionTarget);
  let commandIndex = 0;
  while (commandIndex < words.length && isAssignment(words[commandIndex]?.value ?? "")) commandIndex += 1;
  while (commandIndex < words.length && isControlWord(words[commandIndex]?.value ?? "")) commandIndex += 1;

  const commandWord = words[commandIndex];
  const base = basename(commandWord?.value ?? "");

  for (const word of allWords) {
    scanNested(word, entries, result, depth);
    if (
      hasExecutableArrayIndex(word.value) ||
      hasLiteralExpansionMarker(word) ||
      (base === "grep" && word.value === "$(")
    ) {
      setFirstCause(result, CAUSE.array);
    }
    if (isSpecialAssignment(word.value)) setFirstCause(result, CAUSE.binding);
    scanCommandAssignment(word, entries, result, depth);
  }
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === undefined) continue;
    const canChangeCommand =
      index === commandIndex ||
      (base === "git" && index === commandIndex + 1) ||
      (isShell(base) && index > commandIndex) ||
      (isSourceCommand(base) && index === commandIndex + 1);
    if (word.expanded && canChangeCommand && !isAssignment(word.value)) setFirstCause(result, CAUSE.expansion);
  }

  if (commandWord === undefined || commandWord.expanded) return;
  addDirectMatches(base, commandIndex, words, entries, result);
  if (hasGitEntry(entries) && base === "git") {
    scanGit(words, commandIndex, {
      cause: (reason) => setFirstCause(result, reason),
      scanText: (word, nested) => {
        if (word.expanded) setFirstCause(result, CAUSE.expansion);
        else if (nested) scanReparsed(word.value, entries, result, depth);
        else scanCommandText(word.value, entries, result, depth);
      },
      scanWords: (commandWords) =>
        scanCommand({ words: commandWords, inputFromPipeline: false }, entries, result, depth),
    });
  }
  if (hasBindingEffect(base, words.slice(commandIndex + 1))) setFirstCause(result, CAUSE.binding);
  if (isShell(base)) scanShellReader(base, words, commandIndex, entries, result, depth);
  else if (base === "eval" || ["mapfile", "readarray", "flock", "su", "script"].includes(base)) {
    scanReaderActions(base, words.slice(commandIndex + 1), entries, result, depth);
  }
  if (isSourceCommand(base)) scanSource(words, commandIndex, result);
  if (base === "xargs") scanXargs(words, commandIndex, entries, result, depth);
  if (base === "find") {
    scanFind(words, commandIndex, {
      cause: (reason) => setFirstCause(result, reason),
      scanAction: (action) => scanCommand({ words: action, inputFromPipeline: false }, entries, result, depth),
    });
  }
  if (isWrapper(base)) scanWrapper(base, words, commandIndex, entries, result, depth);
  if (command.inputFromPipeline && isShell(base)) setFirstCause(result, CAUSE.input);
  if (isShell(base) && shellReadsInput(words, commandIndex, command)) setFirstCause(result, CAUSE.input);
  if (base === "builtin" && words[commandIndex + 1] !== undefined) {
    scanCommand(
      { words: words.slice(commandIndex + 1), inputFromPipeline: command.inputFromPipeline },
      entries,
      result,
      depth,
    );
  }
}

function scanNested(word: BashWord, entries: readonly string[], result: ScanResult, depth: number): void {
  for (const nested of word.nested) scanCommand(nested, entries, result, depth);
}

function addDirectMatches(
  base: string,
  commandIndex: number,
  words: BashWord[],
  entries: readonly string[],
  result: ScanResult,
): void {
  for (const entry of entries) {
    const parts = entry.split(" ");
    if (parts.length === 1 && base === entry) result.matches.add(entry);
    if (parts.length === 2) {
      const [program, subcommand] = parts;
      if (base === program) {
        const subcommandIndex = base === "git" ? gitSubcommandIndex(words, commandIndex + 1) : commandIndex + 1;
        if (words[subcommandIndex]?.value === subcommand) result.matches.add(entry);
      }
      if (program === "git" && base.startsWith("git-") && base.slice(4) === subcommand) result.matches.add(entry);
    }
  }
}

function hasGitEntry(entries: readonly string[]): boolean {
  return entries.some((entry) => entry.startsWith("git "));
}

function scanCommandAssignment(word: BashWord, entries: readonly string[], result: ScanResult, depth: number): void {
  const equals = word.value.indexOf("=");
  if (equals < 0) return;
  const name = word.value.slice(0, equals);
  if (
    !COMMAND_TEXT_ASSIGNMENTS.includes(name as (typeof COMMAND_TEXT_ASSIGNMENTS)[number]) &&
    !name.startsWith(GIT_COMMAND_ASSIGNMENT_PREFIX)
  ) {
    return;
  }
  const value = word.value.slice(equals + 1);
  if (word.expanded) setFirstCause(result, CAUSE.gitConfig);
  else scanCommandText(value, entries, result, depth);
}

function scanCommandText(code: string, entries: readonly string[], result: ScanResult, depth: number): void {
  const parsed = parseBashCommand(code);
  for (const command of parsed.commands) scanCommand(command, entries, result, depth);
}

function scanXargs(
  words: BashWord[],
  commandIndex: number,
  entries: readonly string[],
  result: ScanResult,
  depth: number,
): void {
  let index = commandIndex + 1;
  let unknownOption = false;
  while (index < words.length && (words[index]?.value ?? "").startsWith("-")) {
    const option = words[index]?.value ?? "";
    if (XARGS_SAFE_MODES.includes(option as (typeof XARGS_SAFE_MODES)[number])) return;
    if (option === "--") {
      index += 1;
      break;
    }
    if (XARGS_SAFE_OPTIONS.includes(option as (typeof XARGS_SAFE_OPTIONS)[number])) {
      index += 1;
      continue;
    }
    unknownOption = true;
    const takesValue = XARGS_VALUE_OPTIONS.some((name) => option === name);
    index += takesValue ? 2 : 1;
  }
  const candidate = words.slice(index);
  const target = candidate[0];
  if (
    !unknownOption &&
    (target === undefined ||
      (!target.expanded && XARGS_SAFE_COMMANDS.includes(target.value as (typeof XARGS_SAFE_COMMANDS)[number])))
  ) {
    return;
  }
  setFirstCause(result, "xargs can add a denied command from its input");
  if (candidate.length > 0 && !candidate.some((word) => word.expanded)) {
    scanCommand({ words: candidate, inputFromPipeline: false }, entries, result, depth);
  }
}

function scanShellReader(
  base: string,
  words: BashWord[],
  commandIndex: number,
  entries: readonly string[],
  result: ScanResult,
  depth: number,
): void {
  const read = shellRead(base, words, commandIndex + 1);
  if (read.kind === "unknown") setFirstCause(result, READER_CAUSES.option);
  else if (read.kind === "input") setFirstCause(result, READER_CAUSES.input);
  else if (read.kind === "code") {
    if (read.word === undefined) setFirstCause(result, READER_CAUSES.input);
    else if (read.word.expanded) setFirstCause(result, READER_CAUSES.expansion);
    else scanReparsed(read.word.value, entries, result, depth);
  }
}

function scanReaderActions(
  base: string,
  args: BashWord[],
  entries: readonly string[],
  result: ScanResult,
  depth: number,
): void {
  for (const action of readerActions(base, args)) {
    if (action.code.expanded) setFirstCause(result, READER_CAUSES.expansion);
    else scanReparsed(action.code.value, entries, result, depth);
  }
}

function scanWrapper(
  base: string,
  words: BashWord[],
  commandIndex: number,
  entries: readonly string[],
  result: ScanResult,
  depth: number,
): void {
  const args = words.slice(commandIndex + 1);
  if (args.some((word) => word.expanded)) setFirstCause(result, CAUSE.expansion);
  scanReaderActions(base, args, entries, result, depth);
  const target = wrapperTarget(base, args);
  if (target.length > 0) scanCommand({ words: target, inputFromPipeline: false }, entries, result, depth);
}

function scanReparsed(code: string, entries: readonly string[], result: ScanResult, depth: number): void {
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
  else if (isHiddenShellInput(source.value)) setFirstCause(result, CAUSE.input);
}

function shellReadsInput(words: BashWord[], commandIndex: number, command: BashCommand): boolean {
  if (command?.readsInput) return true;
  return words.slice(commandIndex + 1).some((word) => {
    const value = word.value;
    return value === "<" || value === "<<<" || value === "<<" || normalizePath(value) === "dev/stdin";
  });
}

function isSourceCommand(base: string): boolean {
  return base === "." || base === "source";
}

function hasExecutableArrayIndex(value: string): boolean {
  const open = value.indexOf("[");
  const close = value.indexOf("]");
  return open >= 0 && close > open && value.slice(open + 1, close).includes("$(");
}

function hasLiteralExpansionMarker(word: BashWord): boolean {
  for (let index = 0; index < word.parts.length; index += 1) {
    const part = word.parts[index];
    if (part === undefined) continue;
    if (["single-quoted", "ansi-quoted"].includes(part.kind) && /\$\(|`|\$\{/u.test(part.value)) return true;
    if (part.kind !== "escape") continue;
    if (part.value.includes("`")) return true;
    const next = word.parts[index + 1]?.value ?? "";
    const previous = word.parts[index - 1]?.value ?? "";
    if ((part.value === "$" && /^[({]/u.test(next)) || (part.value === "(" && previous === "$")) return true;
  }
  return false;
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

function setFirstCause(result: ScanResult, cause: string): void {
  result.firstCause ??= cause;
}
