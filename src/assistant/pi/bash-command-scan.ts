import { parseBashCommand, type BashCommand, type BashWord, type ParsedBashLine } from "./bash-command-parse.js";
import {
  hasBindingEffect,
  isShell,
  isSpecialAssignment,
  isWrapper,
  readerActions,
  READER_CAUSES,
  shellRead,
  wrapperTarget,
} from "./bash-command-readers.js";

const CAUSE = {
  expansion: "an expansion can change a command name or a word of a denied command",
  input: "a shell or source reads commands that the guard extension cannot see",
  binding: "a command can bind a name to another program",
  option: "an unknown option of git or of a shell",
  array: "an array index can run a command",
  depth: "the command lines are nested more than 8 levels deep",
};

const GIT_GLOBAL_OPTIONS = [
  { names: ["-C", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"], takesValue: true },
  { names: ["-c"], takesValue: true, blocksConfig: true },
  { names: ["--no-pager", "--no-optional-locks", "--bare"], takesValue: false },
] as const;
const GIT_COMMAND_READERS = [
  { command: "rebase", options: ["-x", "--exec"], shell: true },
  { command: "clone", options: ["-u", "--upload-pack"], shell: false },
  { command: "grep", options: ["-O", "--open-files-in-pager"], shell: false },
] as const;
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
    scanEditorAssignment(word, entries, result, depth);
    const canChangeCommand =
      index === commandIndex ||
      (base === "git" && index === commandIndex + 1) ||
      (isShell(base) && index > commandIndex) ||
      (isSourceCommand(base) && index === commandIndex + 1);
    if (word.expanded && canChangeCommand && !isAssignment(word.value)) setFirstCause(result, CAUSE.expansion);
  }

  if (commandWord === undefined || commandWord.expanded) return;
  addDirectMatches(base, commandIndex, words, entries, result);
  if (hasGitEntry(entries) && base === "git") scanGit(words, commandIndex, entries, result, depth);
  if (hasBindingEffect(base, words.slice(commandIndex + 1))) setFirstCause(result, CAUSE.binding);
  if (isShell(base)) scanShellReader(base, words, commandIndex, entries, result, depth);
  else if (base === "eval" || ["mapfile", "readarray", "flock", "su", "script"].includes(base)) {
    scanReaderActions(base, words.slice(commandIndex + 1), entries, result, depth);
  }
  if (isSourceCommand(base)) scanSource(words, commandIndex, result);
  if (base === "xargs") scanXargs(words, commandIndex, entries, result, depth);
  if (base === "find") scanFind(words, commandIndex, entries, result, depth);
  if (isWrapper(base)) scanWrapper(base, words, commandIndex, entries, result, depth);
  if (command.inputFromPipeline && isShell(base)) setFirstCause(result, CAUSE.input);
  if (isShell(base) && shellReadsInput(words, commandIndex, command)) setFirstCause(result, CAUSE.input);
  if (base === "fish") setFirstCause(result, CAUSE.option);
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

function gitSubcommandIndex(words: BashWord[], start: number): number {
  let index = start;
  while (index < words.length) {
    const option = words[index]?.value ?? "";
    if (option === "--") return index + 1;
    const rule = GIT_GLOBAL_OPTIONS.find((candidate) => candidate.names.some((name) => isGitOption(option, name)));
    if (rule === undefined) return index;
    index += rule.takesValue ? (isAttachedGitOption(option, rule.names) ? 1 : 2) : 1;
  }
  return index;
}

function scanGit(
  words: BashWord[],
  commandIndex: number,
  entries: readonly string[],
  result: ScanResult,
  depth: number,
): void {
  let index = commandIndex + 1;
  while (index < words.length) {
    const option = words[index]?.value ?? "";
    if (option === "--") return;
    if (!option.startsWith("-")) break;
    const rule = GIT_GLOBAL_OPTIONS.find((candidate) => candidate.names.some((name) => isGitOption(option, name)));
    if (rule === undefined) {
      setFirstCause(result, CAUSE.option);
      return;
    }
    if ("blocksConfig" in rule && rule.blocksConfig) {
      setFirstCause(result, "git can run a command line from a configuration value");
    }
    if (rule.takesValue) {
      const attached = isAttachedGitOption(option, rule.names);
      const valueIndex = attached ? index : index + 1;
      const value = words[valueIndex];
      if (value?.expanded) setFirstCause(result, CAUSE.expansion);
      index = valueIndex + 1;
    } else index += 1;
  }
  scanGitCommandReader(words[index]?.value ?? "", words, index + 1, entries, result, depth);
}

function isGitOption(value: string, name: string): boolean {
  return (
    value === name ||
    (name.length === 2 && value.startsWith(name) && value.length > name.length) ||
    (name.startsWith("--") && value.startsWith(name + "="))
  );
}

function isAttachedGitOption(value: string, names: readonly string[]): boolean {
  return names.some(
    (name) =>
      (name.length === 2 && value.startsWith(name) && value.length > name.length) ||
      (name.startsWith("--") && value.startsWith(name + "=")),
  );
}

function scanGitCommandReader(
  subcommand: string,
  words: BashWord[],
  start: number,
  entries: readonly string[],
  result: ScanResult,
  depth: number,
): void {
  const reader = GIT_COMMAND_READERS.find((item) => item.command === subcommand);
  if (reader === undefined) return;
  for (let index = start; index < words.length; index += 1) {
    const value = words[index]?.value ?? "";
    const option = reader.options.find(
      (name) => value === name || (value.startsWith(name) && value.length > name.length),
    );
    if (option === undefined) continue;
    const argument =
      value === option ? words[index + 1] : { value: value.slice(option.length), expanded: false, nested: [] };
    if (argument === undefined) continue;
    if (argument.expanded) setFirstCause(result, CAUSE.expansion);
    else if (reader.shell) scanReparsed(argument.value, entries, result, depth);
    else scanCommandText(argument.value, entries, result, depth);
  }
}

function scanEditorAssignment(word: BashWord, entries: readonly string[], result: ScanResult, depth: number): void {
  const equals = word.value.indexOf("=");
  if (equals < 0) return;
  const name = word.value.slice(0, equals);
  if (!["GIT_EDITOR", "GIT_SEQUENCE_EDITOR", "GIT_SSH_COMMAND"].includes(name)) return;
  const value = word.value.slice(equals + 1);
  if (word.expanded) setFirstCause(result, CAUSE.expansion);
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
  setFirstCause(result, "xargs can add a denied command from its input");
  let index = commandIndex + 1;
  while (index < words.length && (words[index]?.value ?? "").startsWith("-")) {
    const option = words[index]?.value ?? "";
    index += ["-I", "-L", "-n", "-P", "-d"].includes(option) ? 2 : 1;
  }
  const candidate = words.slice(index);
  if (candidate.length > 0 && !candidate.some((word) => word.expanded)) {
    scanCommand({ words: candidate, inputFromPipeline: false }, entries, result, depth);
  }
}

function scanFind(
  words: BashWord[],
  commandIndex: number,
  entries: readonly string[],
  result: ScanResult,
  depth: number,
): void {
  for (let index = commandIndex + 1; index < words.length; index += 1) {
    const value = words[index]?.value ?? "";
    if (value === "-exec" || value === "-execdir") {
      const action: BashWord[] = [];
      for (let actionIndex = index + 1; actionIndex < words.length; actionIndex += 1) {
        const part = words[actionIndex];
        if (part === undefined || part.value === ";" || part.value === "+") break;
        action.push(part);
      }
      if (action.length > 0) {
        if (action[0]?.value === "{}") setFirstCause(result, CAUSE.expansion);
        else if (action.some((word) => word.expanded)) setFirstCause(result, CAUSE.expansion);
        else if (action.some((word) => word.value.includes("-c")) && action.some((word) => word.value.includes("{}"))) {
          setFirstCause(result, CAUSE.expansion);
        } else scanCommand({ words: action, inputFromPipeline: false }, entries, result, depth);
      }
      return;
    }
    if (["-name", "-iname", "-path", "-ipath"].includes(value)) {
      index += 1;
      const pattern = words[index];
      if (pattern?.expanded && !isSimpleGlob(pattern.value)) setFirstCause(result, CAUSE.expansion);
      continue;
    }
    if (words[index]?.expanded) setFirstCause(result, CAUSE.expansion);
  }
}

function isSimpleGlob(value: string): boolean {
  return /^[A-Za-z0-9_.*?[\]-]+$/.test(value);
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
  else setFirstCause(result, CAUSE.input);
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

function setFirstCause(result: ScanResult, cause: string): void {
  result.firstCause ??= cause;
}
