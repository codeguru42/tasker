import {
  BASH_INIT_FILE_OPTIONS,
  CALLBACK_READERS,
  COMMAND_STRING_READERS,
  ALIAS_READ_OPTIONS,
  HISTORY_BINDING_OPTIONS,
  SHELLS,
  SPECIAL_ASSIGNMENTS,
  SET_BINDING_OPTIONS,
  VALUE_OPTIONS,
  WRAPPERS,
} from "./bash-command-tables.js";
import type { BashWord } from "./bash-command-parse.js";

export const READER_CAUSES = {
  expansion: "an expansion can change a command name or a word of a denied command",
  input: "a shell or source reads commands that the guard extension cannot see",
  binding: "a command can bind a name to another program",
  option: "an unknown option of git or of a shell",
} as const;

export function isShell(base: string): boolean {
  return Object.hasOwn(SHELLS, base);
}

export function isWrapper(base: string): boolean {
  return WRAPPERS.includes(base as (typeof WRAPPERS)[number]);
}

export function isSpecialAssignment(value: string): boolean {
  const equals = value.indexOf("=");
  if (equals < 0) return false;
  const name = value.slice(0, equals);
  return (
    SPECIAL_ASSIGNMENTS.includes(name as (typeof SPECIAL_ASSIGNMENTS)[number]) ||
    name.startsWith("BASH_CMDS[") ||
    name.startsWith("BASH_ALIASES[")
  );
}

export function hasBindingEffect(base: string, args: BashWord[]): boolean {
  if (base === "alias")
    return args.some((word) => !ALIAS_READ_OPTIONS.includes(word.value as (typeof ALIAS_READ_OPTIONS)[number]));
  if (base === "set") {
    return args.some((word, index) => {
      const value = word.value;
      if (SET_BINDING_OPTIONS.includes(value as (typeof SET_BINDING_OPTIONS)[number])) return true;
      return (
        (value === "-o" || value === "+o") &&
        HISTORY_BINDING_OPTIONS.includes(args[index + 1]?.value as (typeof HISTORY_BINDING_OPTIONS)[number])
      );
    });
  }
  if (base === "shopt") {
    const enablesAliases = args.some((word) => word.value === "-s");
    return enablesAliases && args.some((word) => word.value === "expand_aliases");
  }
  if (base === "history") return true;
  if (base === "trap") return !["-p", "-l"].includes(args[0]?.value ?? "");
  if (base === "fc") return !args[0]?.value.startsWith("-l");
  if (base === "hash") return args.some((word) => /^-[^-]*p/u.test(word.value));
  return false;
}

export interface ReaderAction {
  code: BashWord;
}
export type ShellReadResult = { kind: "unknown" | "input" | "none" } | { kind: "code"; word?: BashWord };

export function shellRead(base: string, words: BashWord[], start: number): ShellReadResult {
  const shell = SHELLS[base as keyof typeof SHELLS];
  if (shell === undefined) return { kind: "unknown" };
  let index = start;
  let commandMode = false;
  while (index < words.length) {
    const word = words[index];
    const value = word?.value ?? "";
    if (value === "--") {
      index += 1;
      break;
    }
    if (value === "-") return { kind: "input" };
    if (base === "bash" && BASH_INIT_FILE_OPTIONS.includes(value as (typeof BASH_INIT_FILE_OPTIONS)[number])) {
      if (words[index + 1] === undefined) return { kind: "unknown" };
      index += 2;
      continue;
    }
    if (base === "bash" && BASH_INIT_FILE_OPTIONS.some((option) => value.startsWith(`${option}=`))) {
      index += 1;
      continue;
    }
    if (!value.startsWith("-") && !value.startsWith("+")) break;
    if (
      value === "--login" ||
      value === "--noprofile" ||
      value === "--norc" ||
      value === "--posix" ||
      value === "--restricted" ||
      value === "--verbose" ||
      value === "--help" ||
      value === "--version"
    ) {
      index += 1;
      continue;
    }
    if (value === "+O" || value === "-o" || value === "-O" || value === "+o") {
      if (words[index + 1] === undefined) return { kind: "unknown" };
      index += 2;
      continue;
    }
    if (value.startsWith("+")) {
      for (let flagIndex = 1; flagIndex < value.length; flagIndex += 1) {
        if (!shell.flags.includes(value[flagIndex] ?? "")) return { kind: "unknown" };
      }
      index += 1;
      continue;
    }
    if (!value.startsWith("-")) return { kind: "unknown" };
    let takesOptionValue = false;
    for (const flag of value.slice(1)) {
      if (flag === "c") commandMode = true;
      else if (flag === "s") return { kind: "input" };
      else if (flag === "o" || flag === "O") takesOptionValue = true;
      else if (!shell.flags.includes(flag)) return { kind: "unknown" };
    }
    index += 1;
    if (takesOptionValue) {
      if (words[index] === undefined) return { kind: "unknown" };
      index += 1;
    }
  }
  if (commandMode) return { kind: "code", word: words[index] };
  if (index === words.length) return { kind: "input" };
  if (isHiddenShellInput(words[index]?.value ?? "")) return { kind: "input" };
  return { kind: "none" };
}

export function readerActions(base: string, args: BashWord[]): ReaderAction[] {
  const actions: ReaderAction[] = [];
  if (base === "eval") {
    if (args.length > 0) actions.push({ code: joinWords(args) });
    return actions;
  }
  if (base === "env") {
    const index = args.findIndex(
      (word) =>
        word.value === "-S" ||
        word.value === "--split-string" ||
        (word.value.startsWith("-S") && word.value.length > 2),
    );
    if (index >= 0) {
      const word = args[index];
      const code = word?.value === "-S" || word?.value === "--split-string" ? args[index + 1] : word;
      if (code !== undefined) actions.push({ code });
    }
    return actions;
  }
  if (COMMAND_STRING_READERS.includes(base as (typeof COMMAND_STRING_READERS)[number])) {
    const flag = base === "flock" ? ["-c", "--command"] : base === "su" ? ["-c", "--command"] : ["-c", "--command"];
    const index = args.findIndex(
      (word) => flag.includes(word.value) || (word.value.startsWith("-c") && word.value.length > 2),
    );
    if (index >= 0) {
      const candidate = args[index];
      const code = candidate?.value === "-c" || candidate?.value === "--command" ? args[index + 1] : candidate;
      if (code !== undefined) actions.push({ code });
    }
    return actions;
  }
  if (CALLBACK_READERS.includes(base as (typeof CALLBACK_READERS)[number])) {
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index]?.value ?? "";
      if (value === "-C" || value === "--callback") {
        const code = args[index + 1];
        if (code !== undefined) actions.push({ code });
        index += 1;
      } else if (value.startsWith("-C") && value.length > 2) {
        actions.push({ code: syntheticWord(value.slice(2)) });
      }
    }
  }
  return actions;
}

export function wrapperTarget(base: string, args: BashWord[]): BashWord[] {
  let index = 0;
  while (index < args.length) {
    const value = args[index]?.value ?? "";
    if (base === "env") {
      if (value === "--") return args.slice(index + 1);
      if (value === "-S" || value === "--split-string") return [];
      if (value.startsWith("-")) index += valueOptions(base).includes(value) ? 2 : 1;
      else if (isAssignment(value)) index += 1;
      else break;
      continue;
    }
    if (base === "flock" && ["-c", "--command"].includes(value)) return [];
    if ((base === "su" || base === "script") && ["-c", "--command"].includes(value)) return [];
    if (value === "--") return args.slice(index + 1);
    if (value.startsWith("-") && valueOptions(base).includes(value)) {
      index += 2;
      continue;
    }
    if (
      value.startsWith("-") &&
      (base === "nohup" ||
        base === "command" ||
        base === "doas" ||
        base === "setsid" ||
        base === "exec" ||
        base === "sudo" ||
        base === "ionice" ||
        base === "chrt" ||
        base === "taskset" ||
        base === "flock" ||
        base === "stdbuf")
    ) {
      index += 1;
      continue;
    }
    if (base === "nice" && value.startsWith("-")) {
      index += 1;
      continue;
    }
    if (base === "timeout" && /^\d/u.test(value)) {
      index += 1;
      continue;
    }
    if (base === "watch" && ["-n", "--interval", "-t", "--chgexit", "-p", "--precise"].includes(value)) {
      index += ["-n", "--interval"].includes(value) ? 2 : 1;
      continue;
    }
    if ((base === "chrt" || base === "taskset") && index === 0 && /^\d/u.test(value)) {
      index += 1;
      continue;
    }
    if (base === "flock" && index === 0) {
      index += 1;
      continue;
    }
    break;
  }
  return args.slice(index);
}

function valueOptions(base: string): readonly string[] {
  return VALUE_OPTIONS[base] ?? [];
}
function isAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\[.*\])?=/u.test(value);
}
function normalizePath(value: string): string {
  return value
    .split("/")
    .filter((part) => part && part !== ".")
    .join("/");
}
export function isHiddenShellInput(value: string): boolean {
  if (!value) return false;
  const normalized = normalizePath(value);
  return (
    value.startsWith("/") ||
    value.startsWith("../") ||
    value.includes("/../") ||
    value === ".." ||
    normalized === "dev/stdin" ||
    normalized.startsWith("dev/fd/")
  );
}
function syntheticWord(value: string): BashWord {
  return { value, expanded: false, nested: [], parts: [], start: 0, end: value.length };
}
function joinWords(words: BashWord[]): BashWord {
  return syntheticWord(words.map((word) => word.value).join(" "));
}
