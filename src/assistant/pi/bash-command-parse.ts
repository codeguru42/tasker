import { tokenizeBashCommand, type BashToken } from "./bash-command-tokenize.js";

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

export class BashParseError extends Error {}

export function parseBashCommand(source: string): ParsedBashLine {
  const tokens = tokenizeBashCommand(source);
  const commands: BashCommand[] = [];
  let words: BashWord[] = [];
  let pipeline = false;
  let readsInput = false;
  const compound: string[] = [];
  const pendingHeredocs: { delimiter: string; quoted: boolean; stripTabs: boolean }[] = [];
  let skipForHeader = false;
  let functionCandidate = false;
  let inCaseHeader = false;
  let inCase = false;
  let skipTimeArgument = false;

  const finish = (end: number) => {
    if (words.length > 0) {
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
      if (!token.quoted && token.value.length > 0) {
        const nested = parseBashCommand(token.value);
        commands.push(...nested.commands);
      }
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
        continue;
      }
      if (op === "<<" || op === "<<-") {
        const delimiter = tokens[i + 1];
        if (delimiter?.kind !== "word") throw new BashParseError("missing here-document delimiter");
        pendingHeredocs.push({ delimiter: delimiter.value, quoted: delimiter.quoted, stripTabs: op === "<<-" });
        i += 1;
        continue;
      }
      if (["<", ">", ">>", "<<<", "<> ", "<&", ">&", "&>", "&>>"].includes(op)) {
        if (["<", "<<<", "<&"].includes(op)) readsInput = true;
        const target = tokens[i + 1];
        if (target?.kind !== "word") throw new BashParseError("missing redirection target");
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
        if (value === "in" && inCaseHeader) words = [];
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
      if (skipForHeader) continue;
      if (["[[", "]]", "((", "))"].includes(token.value)) continue;
      if (functionCandidate) {
        functionCandidate = false;
        continue;
      }
      if (pendingHeredocs.length > 0 && token.value === "") throw new BashParseError("invalid here-document delimiter");
      if (
        token.word.parts.some(
          (part) =>
            part.kind === "substitution" ||
            part.kind === "parameter" ||
            part.kind === "double-quoted" ||
            part.kind === "process-substitution",
        )
      ) {
        token.word.nested.push(...nestedCommands(token.word));
      }
      words.push(token.word);
    }
  }
  finish(source.length);
  if (compound.length !== 0) throw new BashParseError("unclosed compound command");
  return { commands };
}

export type { BashToken };

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
