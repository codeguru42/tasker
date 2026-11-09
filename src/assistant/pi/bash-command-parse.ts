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
  parseError?: BashParseError;
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
  let nestedParseError: BashParseError | undefined;
  const keepNestedError = (error: BashParseError) => {
    nestedParseError ??= error;
  };

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

  let parseError: BashParseError | undefined;
  try {
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === undefined) continue;
      if (token.kind === "heredoc-body") {
        finish(token.start);
        if (!token.quoted && token.value.length > 0) addHereDocNested(commands.at(-1), token.value, keepNestedError);
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
          addWordNested(target.word, keepNestedError);
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
          if (op === "|" || op === "|&") pipeline = true;
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
        const top = compound.at(-1);
        if (value === "then" && top !== "if:condition") throw new BashParseError("then without if");
        if ((value === "elif" || value === "else") && top !== "if:body") {
          throw new BashParseError(`${value} without if`);
        }
        if (value === "fi" && top !== "if:body" && top !== "if:condition") {
          throw new BashParseError("fi without if");
        }
        if (value === "do" && top !== "loop:condition") throw new BashParseError("do without loop");
        if (value === "done" && top !== "loop:body") throw new BashParseError("done without loop");
        if (value === "esac" && top !== "case") throw new BashParseError("esac without case");
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
          if (value === "if") compound.push("if:condition");
          if (["while", "until", "for", "select"].includes(value)) compound.push("loop:condition");
          if (value === "case") compound.push("case");
          if (value === "then") compound[compound.length - 1] = "if:body";
          if (value === "elif") compound[compound.length - 1] = "if:condition";
          if (value === "else") compound[compound.length - 1] = "if:body";
          if (value === "do") compound[compound.length - 1] = "loop:body";
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
        addWordNested(token.word, keepNestedError);
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
    if (tokens.parseError === undefined) finish(source.length);
    if (compound.length !== 0) throw new BashParseError("unclosed compound command");
  } catch (error) {
    if (!(error instanceof BashParseError)) throw error;
    parseError = error;
  }
  parseError ??= nestedParseError ?? tokens.parseError;
  return { commands, ...(parseError === undefined ? {} : { parseError }) };
}

export type { BashToken };

function addWordNested(word: BashWord, onError: (error: BashParseError) => void): void {
  if (
    word.parts.some((part) =>
      ["substitution", "parameter", "double-quoted", "process-substitution", "arithmetic"].includes(part.kind),
    )
  ) {
    word.nested.push(...nestedCommands(word, onError));
  }
}

function deferWordsNested(words: BashWord[], deferred: BashCommand[]): void {
  for (const word of words) deferred.push(...word.nested);
}

function addHereDocNested(
  command: BashCommand | undefined,
  body: string,
  onError: (error: BashParseError) => void,
): void {
  if (command?.words[0] === undefined) return;
  for (const nestedSource of nestedSources(body)) {
    const parsed = parseBashCommand(nestedSource);
    command.words[0].nested.push(...parsed.commands);
    if (parsed.parseError !== undefined) onError(parsed.parseError);
  }
}

function nestedCommands(word: BashWord, onError: (error: BashParseError) => void): BashCommand[] {
  const found: BashCommand[] = [];
  for (const part of word.parts) {
    for (const source of nestedSources(part.value)) {
      const parsed = parseBashCommand(source);
      found.push(...parsed.commands);
      if (parsed.parseError !== undefined) onError(parsed.parseError);
    }
  }
  return found;
}

function nestedSources(source: string): string[] {
  const found: string[] = [];
  let quote = "";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? "";
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "'" && quote !== '"') {
      quote = quote === "'" ? "" : "'";
      continue;
    }
    if (char === '"' && quote !== "'") {
      quote = quote === '"' ? "" : '"';
      continue;
    }
    if (quote === "'" || (char === "#" && (i === 0 || /\s/u.test(source[i - 1] ?? "")))) {
      if (char === "#") while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (char === "`") {
      let end = i + 1;
      while (end < source.length && source[end] !== "`") {
        if (source[end] === "\\") end += 1;
        end += 1;
      }
      if (end >= source.length) throw new BashParseError("unclosed backtick");
      found.push(source.slice(i + 1, end));
      i = end;
      continue;
    }
    if (
      (char === "$" && source[i + 1] === "(" && source[i + 2] !== "(") ||
      ((char === "<" || char === ">") && source[i + 1] === "(")
    ) {
      const opening = i + 1;
      const end = findClosingParen(source, opening);
      found.push(source.slice(opening + 1, end));
      i = end;
    }
  }
  return found;
}

function findClosingParen(source: string, opening: number): number {
  let depth = 0;
  let quote = "";
  const cases: ("header" | "pattern" | "body")[] = [];
  let word = "";
  const finishWord = () => {
    if (word === "case") cases.push("header");
    else if (word === "in" && cases.at(-1) === "header") cases[cases.length - 1] = "pattern";
    else if (word === "esac" && cases.length > 0) cases.pop();
    word = "";
  };
  for (let i = opening; i < source.length; i += 1) {
    const char = source[i] ?? "";
    if (char === "\\" && quote !== "'") {
      i += 1;
      continue;
    }
    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      finishWord();
      quote = quote ? "" : char;
      continue;
    }
    if (quote) continue;
    if (char === "#" && (i === 0 || /\s/u.test(source[i - 1] ?? ""))) {
      finishWord();
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (/[A-Za-z0-9_]/u.test(char)) {
      word += char;
      continue;
    }
    finishWord();
    if (char === ";" && source.startsWith(";;", i)) {
      if (cases.at(-1) === "body") cases[cases.length - 1] = "pattern";
      i += 1;
      continue;
    }
    if (char === ")" && cases.at(-1) === "pattern") {
      cases[cases.length - 1] = "body";
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")" && --depth === 0) return i;
  }
  throw new BashParseError("unclosed substitution");
}
