import { BashParseError, tokenizeBashCommand, type BashToken } from "./bash-command-tokenize.js";

export interface BashWordPart {
  kind:
    | "literal"
    | "single-quoted"
    | "double-quoted"
    | "ansi-quoted"
    | "locale-quoted"
    | "escape"
    | "parameter"
    | "substitution"
    | "arithmetic"
    | "process-substitution"
    | "glob"
    | "brace"
    | "tilde";
  value: string;
  quoted: boolean;
  start: number;
  end: number;
}

export interface BashWord {
  value: string;
  expanded: boolean;
  nested: BashCommand[];
  parts: BashWordPart[];
  start?: number;
  end?: number;
  redirectionTarget?: boolean;
}

export interface BashCommand {
  words: BashWord[];
  inputFromPipeline: boolean;
  readsInput?: boolean;
  start?: number;
  end?: number;
}

export interface ParsedBashLine {
  commands: BashCommand[];
}

export { BashParseError };

export function parseBashCommand(source: string): ParsedBashLine {
  const tokens = tokenizeBashCommand(source);
  const commands: BashCommand[] = [];
  let words: BashWord[] = [];
  let pipeline = false;
  let readsInput = false;
  const compound: string[] = [];
  let skipForHeader = false;
  let functionCandidate = false;
  let inCaseHeader = false;
  let inCase = false;
  let inCasePattern = false;
  let skipTimeArgument = false;
  let deferredNested: BashCommand[] = [];

  const finish = (end: number) => {
    if (words.length > 0) {
      if (words[0] !== undefined && deferredNested.length > 0) {
        words[0].nested.push(...deferredNested);
        deferredNested = [];
      }
      commands.push({ words, inputFromPipeline: pipeline, readsInput, start: words[0]?.start ?? end, end });
      words = [];
    }
    pipeline = false;
    readsInput = false;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) continue;
    if (token.kind === "heredoc-body") {
      finish(token.start);
      if (!token.quoted && token.value.length > 0) addHereDocNested(commands.at(-1), token.value);
      continue;
    }
    if (token.kind === "newline" || token.kind === "operator") {
      const op = token.value;
      if (token.kind === "newline") {
        finish(token.start);
        continue;
      }
      if ([";;&", ";;", ";&"].includes(op)) {
        finish(token.start);
        if (inCase) inCasePattern = true;
        continue;
      }
      if (op === "<<" || op === "<<-") {
        readsInput = true;
        const delimiter = tokens[i + 1];
        if (delimiter?.kind !== "word") throw new BashParseError("missing here-document delimiter");
        i += 1;
        continue;
      }
      if (["<", ">", ">>", "<<<", "<> ", "<&", ">&", "&>", "&>>"].includes(op)) {
        if (["<", "<<<", "<&"].includes(op)) readsInput = true;
        const target = tokens[i + 1];
        if (target?.kind !== "word") throw new BashParseError("missing redirection target");
        target.word.redirectionTarget = true;
        addWordNested(target.word);
        words.push(target.word);
        i += 1;
        continue;
      }
      if (
        op === "(" ||
        op === "{" ||
        op === ")" ||
        op === "}" ||
        op === ";" ||
        op === "&" ||
        op === "&&" ||
        op === "||" ||
        op === "|" ||
        op === "|&"
      ) {
        if (op === ")" && inCase) {
          words = [];
          inCasePattern = false;
          continue;
        }
        if (op === "(" && words.length === 1 && tokens[i + 1]?.kind === "operator" && tokens[i + 1]?.value === ")") {
          words = [];
          i += 1;
          continue;
        }
        finish(token.start);
        if (op === "|") pipeline = true;
        if (op === "(" || op === "{") compound.push(op);
        if (op === ")" || op === "}") {
          const expected = op === ")" ? "(" : "{";
          if (compound.pop() !== expected) throw new BashParseError("unmatched compound command delimiter");
        }
        continue;
      }
    }

    if (token.kind === "keyword") {
      const value = token.value;
      if (value === "time") skipTimeArgument = true;
      if (value === "case") {
        inCaseHeader = true;
        inCase = true;
        inCasePattern = true;
      }
      if (value === "for" || value === "select") skipForHeader = true;
      if (value === "do") skipForHeader = false;
      if (value === "function") functionCandidate = true;
      if (
        [
          "then",
          "do",
          "elif",
          "else",
          "fi",
          "done",
          "in",
          "esac",
          "select",
          "case",
          "if",
          "while",
          "until",
          "for",
          "function",
          "time",
          "coproc",
        ].includes(value)
      ) {
        if (value === "in" && inCaseHeader) {
          deferWordsNested(words, deferredNested);
          words = [];
        }
        finish(token.start);
        if (value === "in" && inCaseHeader) {
          inCaseHeader = false;
          words = [];
          continue;
        }
        if (value === "esac") inCase = false;
        if (value === "in" && skipForHeader) {
          words = [];
          continue;
        }
        if (["if", "while", "until", "for", "case"].includes(value)) compound.push(value);
        if (["fi", "done", "esac"].includes(value)) compound.pop();
        continue;
      }
    }
    if (token.kind === "word") {
      if (skipTimeArgument && token.value === "-p") {
        skipTimeArgument = false;
        continue;
      }
      skipTimeArgument = false;
      addWordNested(token.word);
      if (skipForHeader || inCaseHeader || (inCase && inCasePattern)) {
        deferredNested.push(...token.word.nested);
        continue;
      }
      if (["[[", "]]", "((", "))"].includes(token.value)) continue;
      if (functionCandidate) {
        functionCandidate = false;
        continue;
      }
      words.push(token.word);
    }
  }
  finish(source.length);
  if (compound.length !== 0) throw new BashParseError("unclosed compound command");
  return { commands };
}

export type { BashToken };

function addWordNested(word: BashWord): void {
  if (
    word.parts.some((part) =>
      ["substitution", "parameter", "double-quoted", "process-substitution", "arithmetic"].includes(part.kind),
    )
  ) {
    word.nested.push(...nestedCommands(word));
  }
}

function deferWordsNested(words: BashWord[], deferred: BashCommand[]): void {
  for (const word of words) deferred.push(...word.nested);
}

function addHereDocNested(command: BashCommand | undefined, body: string): void {
  if (command?.words[0] === undefined) return;
  const pattern = /\$\((?!\()([\s\S]*?)\)|`([^`]*)`/gu;
  for (const match of body.matchAll(pattern)) {
    const nested = parseBashCommand(match[1] ?? match[2] ?? "");
    command.words[0].nested.push(...nested.commands);
  }
}

function nestedCommands(word: BashWord): BashCommand[] {
  const found: BashCommand[] = [];
  for (const part of word.parts) {
    const source = part.value;
    const bodies: string[] = [];
    const pattern = /\$\((?!\()([\s\S]*?)\)|`([^`]*)`|[<>]\(([^)]*)\)/gu;
    for (const match of source.matchAll(pattern)) bodies.push(match[1] ?? match[2] ?? match[3] ?? "");
    for (const body of bodies) found.push(...parseBashCommand(body).commands);
  }
  return found;
}
