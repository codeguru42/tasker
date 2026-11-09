import { GIT_CONFIG_EXEC_OPTIONS, GIT_GLOBAL_OPTIONS, GIT_READERS } from "./bash-command-tables.js";
import type { BashWord } from "./bash-command-parse.js";

const CONFIG_CAUSE = "git can run a command line from a configuration value";
const OPTION_CAUSE = "an unknown option of git or of a shell";
const EXPANSION_CAUSE = "an expansion can change a command name or a word of a denied command";

export interface GitScanHooks {
  cause(reason: string): void;
  scanText(value: BashWord): void;
  scanWords(words: BashWord[]): void;
}

export function gitSubcommandIndex(words: BashWord[], start: number): number {
  let index = start;
  while (index < words.length) {
    const value = words[index]?.value ?? "";
    if (value === "--") return index + 1;
    if (!value.startsWith("-")) return index;
    const rule = globalRule(value);
    if (rule === undefined) return index;
    if (rule.value === "required") index += isAttached(value, rule.names) ? 1 : 2;
    else if (rule.value === "attached-required" && !isAttached(value, rule.names)) return index;
    else index += 1;
  }
  return index;
}

export function scanGit(words: BashWord[], commandIndex: number, hooks: GitScanHooks): void {
  let index = commandIndex + 1;
  while (index < words.length) {
    const value = words[index]?.value ?? "";
    if ((value.startsWith("-C") || value.startsWith("-c")) && value.length > 2) {
      hooks.cause(OPTION_CAUSE);
      return;
    }
    if (value === "--") {
      index += 1;
      break;
    }
    if (!value.startsWith("-")) break;
    const rule = globalRule(value);
    if (rule === undefined) {
      hooks.cause(OPTION_CAUSE);
      return;
    }
    if (GIT_CONFIG_EXEC_OPTIONS.some((name) => optionMatches(value, name))) hooks.cause(CONFIG_CAUSE);
    if (rule.value === "none") {
      index += 1;
      continue;
    }
    const attached = isAttached(value, rule.names);
    if (rule.value === "attached-required" && !attached) {
      hooks.cause(OPTION_CAUSE);
      return;
    }
    if (rule.value === "optional-attached" && !attached) {
      index += 1;
      continue;
    }
    const valueIndex = attached ? index : index + 1;
    const argument = words[valueIndex];
    if (argument === undefined) {
      hooks.cause(OPTION_CAUSE);
      return;
    }
    if (argument.expanded) hooks.cause(EXPANSION_CAUSE);
    index = valueIndex + 1;
  }

  const subcommand = words[index]?.value ?? "";
  const start = index + 1;
  const reader = GIT_READERS.find((item) => item.command === subcommand);
  if (reader === undefined) return;
  if (reader.standalone) {
    if (subcommand === "bisect") {
      if (words[start]?.value === "run") {
        let commandStart = start + 1;
        while (words[commandStart]?.value === "--no-checkout" || words[commandStart]?.value === "--first-parent")
          commandStart += 1;
        hooks.scanWords(words.slice(commandStart));
      }
      return;
    }
    let codeIndex = start + 1;
    if (words[start]?.value === "foreach" && words[codeIndex]?.value === "--recursive") codeIndex += 1;
    const code = words[codeIndex];
    if (words[start]?.value === "foreach" && code !== undefined) hooks.scanText(code);
    return;
  }

  for (let at = start; at < words.length; at += 1) {
    const value = words[at]?.value ?? "";
    const option = reader.options.find((candidate) => optionMatches(value, candidate));
    if (option === undefined) continue;
    const attached = value !== option;
    const argument = attached
      ? syntheticWord(value.slice(option.length + (value[option.length] === "=" ? 1 : 0)))
      : words[at + 1];
    if (argument === undefined) continue;
    hooks.scanText(argument);
  }
}

function globalRule(value: string): (typeof GIT_GLOBAL_OPTIONS)[number] | undefined {
  return GIT_GLOBAL_OPTIONS.find((rule) => rule.names.some((name) => optionMatches(value, name)));
}

function optionMatches(value: string, name: string): boolean {
  if (value === name || value.startsWith(`${name}=`)) return true;
  return name.length === 2 && value.startsWith(name) && value.length > name.length && name[1] !== "-";
}

function isAttached(value: string, names: readonly string[]): boolean {
  return names.some(
    (name) =>
      value !== name &&
      (value.startsWith(`${name}=`) || (name.length === 2 && value.startsWith(name) && value.length > name.length)),
  );
}

function syntheticWord(value: string): BashWord {
  return { value, expanded: false, nested: [], parts: [], start: 0, end: value.length };
}
