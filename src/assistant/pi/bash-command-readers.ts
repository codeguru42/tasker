import {
  BASH_INIT_FILE_OPTIONS,
  CALLBACK_READERS,
  COMMAND_STRING_READERS,
  ALIAS_READ_OPTIONS,
  HISTORY_BINDING_OPTIONS,
  SHELLS,
  SPECIAL_ASSIGNMENTS,
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
  return SPECIAL_ASSIGNMENTS.includes(name as (typeof SPECIAL_ASSIGNMENTS)[number]);
}

export function hasBindingEffect(base: string, args: BashWord[]): boolean {
  if (base === "alias")
    return args.some((word) => !ALIAS_READ_OPTIONS.includes(word.value as (typeof ALIAS_READ_OPTIONS)[number]));
  if (base === "set") {
    return args.some((word, index) => {
      const value = word.value;
      if (/^[-+][A-Za-z]*H[A-Za-z]*$/u.test(value)) return true;
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
  if (base === "fc") return true;
  if (base === "hash") return args.some((word) => /^-[^-]*p/u.test(word.value));
  return false;
}

interface ReaderAction {
  code: BashWord;
}
type ShellReadResult = { kind: "unknown" | "input" | "none" } | { kind: "code"; word?: BashWord };

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
  if (base === "eval" || base === "watch" || base === "sudo") {
    for (let index = 0; index < args.length; index += 1) actions.push({ code: joinWords(args.slice(index)) });
    return actions;
  }
  if (base === "env") {
    addLaterWordActions(args, actions);
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index]?.value ?? "";
      if (value === "-S" || value === "--split-string") {
        const code = args[index + 1];
        if (code !== undefined) actions.push({ code });
      } else if (value.startsWith("-") && !value.startsWith("--")) {
        const marker = value.indexOf("S", 1);
        if (marker >= 0 && marker + 1 < value.length) {
          actions.push({ code: syntheticWord(value.slice(marker + 1), args[index]) });
        }
      }
    }
    return actions;
  }
  if (base === "trap") {
    addLaterWordActions(args, actions);
    return actions;
  }
  if (COMMAND_STRING_READERS.includes(base as (typeof COMMAND_STRING_READERS)[number])) {
    addLaterWordActions(args, actions);
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index]?.value ?? "";
      if (value === "-c" || value === "--command") {
        const code = args[index + 1];
        if (code !== undefined) actions.push({ code });
      } else if (value.startsWith("-") && !value.startsWith("--")) {
        const marker = value.indexOf("c", 1);
        if (marker >= 0 && marker + 1 < value.length) {
          actions.push({ code: syntheticWord(value.slice(marker + 1), args[index]) });
        }
      }
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
        actions.push({ code: syntheticWord(value.slice(2), args[index]) });
      }
    }
  }
  return actions;
}

export function isHiddenShellInput(value: string): boolean {
  if (!value) return false;
  const parts = value.split("/").filter((part) => part && part !== ".");
  return parts.includes("..") || parts[0] === "dev" || parts[0] === "proc";
}
function syntheticWord(value: string, source?: BashWord): BashWord {
  return {
    value,
    expanded: source?.expanded ?? false,
    nested: source?.nested ?? [],
    parts: source?.parts ?? [],
    start: 0,
    end: value.length,
  };
}

function addLaterWordActions(args: BashWord[], actions: ReaderAction[]): void {
  for (const word of args) {
    actions.push({ code: word });
    const value = word.value;
    if (value.startsWith("--")) {
      const equals = value.indexOf("=");
      if (equals >= 0 && equals + 1 < value.length)
        actions.push({ code: syntheticWord(value.slice(equals + 1), word) });
    }
  }
}
function joinWords(words: BashWord[]): BashWord {
  return syntheticWord(words.map((word) => word.value).join(" "));
}
