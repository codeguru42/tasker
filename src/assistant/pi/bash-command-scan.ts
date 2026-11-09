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
const GIT_GLOBAL_OPTIONS = [
  { names: ["-C", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"], takesValue: true },
  { names: ["-c"], takesValue: true, blocksConfig: true },
  { names: ["--no-pager", "--no-optional-locks", "--bare"], takesValue: false },
] as const;
const WRAPPERS = ["env", "nice", "timeout", "watch", "nohup", "command", "stdbuf"] as const;
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
  if (isBindingCommand(base, words.slice(commandIndex + 1))) setFirstCause(result, CAUSE.binding);
  if (isLineReader(base)) scanLineReader(base, words, commandIndex, entries, result, depth);
  if (isSourceCommand(base)) scanSource(words, commandIndex, result);
  if (base === "xargs") scanXargs(words, commandIndex, entries, result, depth);
  if (base === "find") scanFind(words, commandIndex, entries, result, depth);
  if (isWrapper(base)) scanWrapper(base, words, commandIndex, entries, result, depth);
  if (command.inputFromPipeline && isShell(base)) setFirstCause(result, CAUSE.input);
  if (isShell(base) && shellReadsInput(words, commandIndex, command)) setFirstCause(result, CAUSE.input);
  if (base === "fish") setFirstCause(result, CAUSE.option);
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
  if (base === "env") {
    const split = args.findIndex((word) => word.value === "-S" || word.value === "--split-string");
    if (split >= 0) {
      const code = args[split + 1];
      if (code?.expanded) setFirstCause(result, CAUSE.expansion);
      else if (code !== undefined) scanReparsed(code.value, entries, result, depth);
      return;
    }
  }
  if (base === "script") {
    const commandFlag = args.findIndex((word) => word.value.includes("c"));
    if (commandFlag >= 0) {
      const code = args[commandFlag + 1];
      if (code?.expanded) setFirstCause(result, CAUSE.expansion);
      else if (code !== undefined) scanReparsed(code.value, entries, result, depth);
      return;
    }
  }
  const target = wrapperTarget(base, args);
  if (target.length > 0) scanCommand({ words: target, inputFromPipeline: false }, entries, result, depth);
}

function wrapperTarget(base: string, args: BashWord[]): BashWord[] {
  let index = 0;
  while (index < args.length) {
    const value = args[index]?.value ?? "";
    if (base === "env") {
      if (value === "--") return args.slice(index + 1);
      if (value.startsWith("-")) index += ["-u", "--unset", "-C", "--chdir"].includes(value) ? 2 : 1;
      else if (isAssignment(value)) index += 1;
      else break;
      continue;
    }
    if (base === "nice" && (value === "-n" || value === "--adjustment")) index += 2;
    else if (base === "timeout" && index === 0 && !value.startsWith("-")) index += 1;
    else if (base === "watch" && ["-n", "--interval", "-d", "--differences"].includes(value)) {
      index += value === "-n" || value === "--interval" ? 2 : 1;
    } else if (value.startsWith("-") && (base === "nohup" || base === "command")) index += 1;
    else break;
  }
  return args.slice(index);
}

function isWrapper(base: string): boolean {
  return WRAPPERS.includes(base as (typeof WRAPPERS)[number]);
}

function scanLineReader(
  base: string,
  words: BashWord[],
  commandIndex: number,
  entries: readonly string[],
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
