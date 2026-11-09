import { FIND_ACTIONS, FIND_VALUE_PREDICATES } from "./bash-command-tables.js";
import type { BashWord } from "./bash-command-parse.js";

const EXPANSION_CAUSE = "an expansion can change a command name or a word of a denied command";

interface FindScanHooks {
  cause(reason: string): void;
  scanAction(words: BashWord[]): void;
}

export function scanFind(words: BashWord[], commandIndex: number, hooks: FindScanHooks): void {
  for (let index = commandIndex + 1; index < words.length; index += 1) {
    const value = words[index]?.value ?? "";
    if (FIND_ACTIONS.includes(value as (typeof FIND_ACTIONS)[number])) {
      const action: BashWord[] = [];
      let end = index + 1;
      for (; end < words.length; end += 1) {
        const part = words[end];
        if (part === undefined || part.value === ";" || part.value === "+") break;
        action.push(part);
      }
      if (action.length > 0) {
        const commandSubstitution =
          action.some((word) => word.value.includes("-c")) && action.some((word) => word.value.includes("{}"));
        if (
          action[0]?.value === "{}" ||
          action.some((word) => word.value === "{}") ||
          commandSubstitution ||
          action.some((word) => word.expanded)
        ) {
          hooks.cause(EXPANSION_CAUSE);
        }
        hooks.scanAction(action);
      }
      index = end;
      continue;
    }
    if (FIND_VALUE_PREDICATES.includes(value as (typeof FIND_VALUE_PREDICATES)[number])) {
      const pattern = words[index + 1];
      if (pattern?.expanded && !isSimpleGlob(pattern.value)) hooks.cause(EXPANSION_CAUSE);
      index += 1;
      continue;
    }
    const word = words[index];
    if (word?.expanded) hooks.cause(EXPANSION_CAUSE);
  }
}

function isSimpleGlob(value: string): boolean {
  return /^[A-Za-z0-9_.*?[\]-]+$/u.test(value);
}
