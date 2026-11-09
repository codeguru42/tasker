import type { BashCommand, BashWord, BashWordPart } from "./bash-command-parse.js";

export type BashToken =
  | { kind: "word"; value: string; quoted: boolean; word: BashWord; start: number; end: number }
  | { kind: "operator" | "newline" | "keyword"; value: string; start: number; end: number }
  | { kind: "heredoc-body"; value: string; quoted: boolean; start: number; end: number };

export class BashParseError extends Error {}

const OPERATORS = [
  ";;&",
  "]]",
  "[[",
  "<<<",
  "<<-",
  "&&",
  "||",
  "|&",
  ">>",
  "<<",
  "<&",
  ">&",
  "&>>",
  "&>",
  "<> ",
  ";",
  "|",
  "&",
  "<",
  ">",
  "(",
  ")",
  "{",
  "}",
];
const KEYWORDS = new Set([
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "while",
  "until",
  "do",
  "done",
  "for",
  "select",
  "in",
  "case",
  "esac",
  "function",
  "coproc",
  "time",
]);

export function tokenizeBashCommand(input: string): BashToken[] {
  const source = joinEscapedNewlines(input);
  const tokens: BashToken[] = [];
  let index = 0;
  let pending: { delimiter: string; quoted: boolean; stripTabs: boolean }[] = [];
  let commandPosition = true;
  let header: "case" | "for" | "select" | undefined;

  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === " " || char === "\t" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/u.test(source[index - 1] ?? ""))) {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "\n") {
      tokens.push({ kind: "newline", value: "\n", start: index, end: index + 1 });
      index += 1;
      if (pending.length > 0) {
        for (const doc of pending) {
          const start = index;
          let body = "";
          while (index <= source.length) {
            const lineEnd = source.indexOf("\n", index);
            const end = lineEnd < 0 ? source.length : lineEnd;
            const line = source.slice(index, end);
            const compare = doc.stripTabs ? line.replace(/^\t+/u, "") : line;
            if (compare === doc.delimiter) {
              index = lineEnd < 0 ? end : end + 1;
              break;
            }
            body += line + (lineEnd < 0 ? "" : "\n");
            if (lineEnd < 0) {
              index = source.length;
              break;
            }
            index = end + 1;
          }
          tokens.push({ kind: "heredoc-body", value: body, quoted: doc.quoted, start, end: index });
        }
        pending = [];
      }
      commandPosition = true;
      continue;
    }

    if (source.startsWith("((", index)) {
      const end = source.indexOf("))", index + 2);
      if (end < 0) throw new BashParseError("unclosed arithmetic command");
      const value = source.slice(index + 2, end);
      const part: BashWordPart = { kind: "arithmetic", value, quoted: false, start: index, end: end + 2 };
      const word: BashWord = { value, expanded: false, nested: [], parts: [part], start: index, end: end + 2 };
      tokens.push({ kind: "word", value, quoted: false, word, start: index, end: end + 2 });
      index = end + 2;
      commandPosition = false;
      continue;
    }

    const fd = /^(\d+)(?=<<|<|>>|>)/u.exec(source.slice(index));
    if (fd) index += fd[0].length;
    if (source.startsWith("<(", index) || source.startsWith(">(", index)) {
      const parsedProcess = readWord(source, index);
      if (parsedProcess === undefined) throw new BashParseError("invalid process substitution");
      tokens.push({
        kind: "word",
        value: parsedProcess.word.value,
        quoted: true,
        word: parsedProcess.word,
        start: parsedProcess.start,
        end: parsedProcess.end,
      });
      index = parsedProcess.end;
      commandPosition = false;
      continue;
    }
    const operator = OPERATORS.find((item) => {
      const op = item.trimEnd();
      if (op === "{" && !/\s/u.test(source[index + 1] ?? "")) return false;
      if (op === "}" && !/\s/u.test(source[index - 1] ?? "")) return false;
      return op === source.slice(index, index + op.length);
    });
    if (operator !== undefined) {
      const value = operator.trimEnd();
      tokens.push({ kind: "operator", value, start: index, end: index + value.length });
      index += value.length;
      if (value === "<<" || value === "<<-") {
        const delimiterToken = readWord(source, index);
        if (delimiterToken === undefined) throw new BashParseError("missing here-document delimiter");
        tokens.push({
          kind: "word",
          value: delimiterToken.word.value,
          quoted: delimiterToken.word.expanded,
          word: delimiterToken.word,
          start: delimiterToken.start,
          end: delimiterToken.end,
        });
        pending.push({
          delimiter: delimiterToken.word.value,
          quoted: delimiterToken.word.parts.some((part) => part.quoted),
          stripTabs: value === "<<-",
        });
        index = delimiterToken.end;
      } else if (["<", ">", ">>", "<<<", "<&", ">&", "&>", "&>>"].includes(value)) {
        const target = readWord(source, index);
        if (target !== undefined) {
          tokens.push({
            kind: "word",
            value: target.word.value,
            quoted: target.word.expanded,
            word: target.word,
            start: target.start,
            end: target.end,
          });
          index = target.end;
        }
      }
      if ([";", ";;&", "&&", "||", "|", "|&", "&", ")"].includes(value)) commandPosition = true;
      continue;
    }
    const parsed = readWord(source, index);
    if (parsed === undefined) throw new BashParseError(`cannot tokenize at ${index}`);
    const value = parsed.word.value;
    if (/\{[^{}]*,[^{}]*\}/u.test(source.slice(parsed.start, parsed.end))) parsed.word.expanded = true;
    if (
      (commandPosition || (value === "in" && header !== undefined)) &&
      KEYWORDS.has(value) &&
      parsed.word.parts.every((part) => part.kind === "literal")
    ) {
      tokens.push({ kind: "keyword", value, start: parsed.start, end: parsed.end });
      if (value === "case" || value === "for" || value === "select") header = value;
      else if (value === "in") header = undefined;
      commandPosition = [
        "if",
        "then",
        "elif",
        "else",
        "while",
        "until",
        "do",
        "for",
        "select",
        "case",
        "time",
        "coproc",
      ].includes(value);
    } else {
      tokens.push({
        kind: "word",
        value,
        quoted: parsed.word.expanded,
        word: parsed.word,
        start: parsed.start,
        end: parsed.end,
      });
      commandPosition = false;
    }
    index = parsed.end;
  }
  return tokens;
}

function joinEscapedNewlines(source: string): string {
  let out = "";
  let quote = "";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? "";
    if (char === "\\" && source[i + 1] === "\n" && quote !== "'") {
      i += 1;
      continue;
    }
    out += char;
    if (char === "'" && quote !== '"') quote = quote === "'" ? "" : "'";
    else if (char === '"' && quote !== "'") quote = quote === '"' ? "" : '"';
  }
  return out;
}

function readWord(source: string, start: number): { word: BashWord; start: number; end: number } | undefined {
  let i = start;
  let value = "";
  let expanded = false;
  const parts: BashWordPart[] = [];
  const nested: BashCommand[] = [];
  const append = (kind: BashWordPart["kind"], text: string, quoted: boolean, from: number, to: number) => {
    if (text) parts.push({ kind, value: text, quoted, start: from, end: to });
  };
  while (i < source.length) {
    const c = source[i] ?? "";
    const operatorHere = OPERATORS.some((item) => {
      const op = item.trimEnd();
      if (op === "{" && !/\s/u.test(source[i + 1] ?? "")) return false;
      if (op === "}" && !/\s/u.test(source[i - 1] ?? "")) return false;
      return op === source.slice(i, i + op.length);
    });
    if (/\s/u.test(c) || (operatorHere && !((c === "<" || c === ">") && source[i + 1] === "("))) break;
    if (c === "'") {
      const end = source.indexOf("'", i + 1);
      if (end < 0) throw new BashParseError("unclosed single quote");
      const text = source.slice(i + 1, end);
      value += text;
      append("single-quoted", text, true, i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === "$" && (source[i + 1] === "'" || source[i + 1] === '"')) {
      const q = source[i + 1] as "'" | '"';
      const end = source.indexOf(q, i + 2);
      if (end < 0) throw new BashParseError("unclosed dollar quote");
      const text = source.slice(i + 2, end);
      value += text;
      expanded ||= q === "'";
      append(q === "'" ? "ansi-quoted" : "locale-quoted", text, true, i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      const startQuote = i++;
      let text = "";
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "`" || (source[i] === "$" && source[i + 1] === "(")) {
          expanded = true;
        }
        if (source[i] === "\\" && i + 1 < source.length) {
          i += 1;
          text += source[i];
          i += 1;
          continue;
        }
        text += source[i];
        i += 1;
      }
      if (source[i] !== '"') throw new BashParseError("unclosed double quote");
      value += text;
      expanded ||= /[$`]/u.test(text);
      append("double-quoted", text, true, startQuote, i + 1);
      i += 1;
      continue;
    }
    if (c === "\\") {
      if (i + 1 >= source.length) throw new BashParseError("unfinished escape");
      value += source[i + 1];
      append("escape", source[i + 1] ?? "", true, i, i + 2);
      i += 2;
      continue;
    }
    if (c === "$" || c === "`" || (c === "<" && source[i + 1] === "(") || (c === ">" && source[i + 1] === "(")) {
      const startPart = i;
      let kind: BashWordPart["kind"] = "parameter";
      let end = i + 1;
      if (c === "`") {
        kind = "substitution";
        end = source.indexOf("`", i + 1);
        if (end < 0) throw new BashParseError("unclosed backtick");
        end += 1;
      } else if (c === "<" || c === ">") {
        kind = "process-substitution";
        end = matching(source, i + 1, "(", ")") + 1;
      } else if (source[i + 1] === "(" && source[i + 2] === "(") {
        kind = "arithmetic";
        end = source.indexOf("))", i + 3);
        if (end < 0) throw new BashParseError("unclosed arithmetic expansion");
        end += 2;
      } else if (source[i + 1] === "(") {
        kind = "substitution";
        end = matching(source, i + 1, "(", ")") + 1;
      } else if (source[i + 1] === "{") {
        end = matching(source, i + 1, "{", "}") + 1;
      } else {
        while (/[A-Za-z0-9_@*?$#!-]/u.test(source[end] ?? "")) end += 1;
      }
      const text = source.slice(i, end);
      value += text;
      expanded = true;
      append(kind, text, false, startPart, end);
      i = end;
      continue;
    }
    if (c === "*" || c === "?" || c === "[") {
      expanded = true;
      append("glob", c, false, i, i + 1);
    } else if (c === "~" && i === start) append("tilde", c, false, i, i + 1);
    else if (c === "{" || c === "}") {
      expanded ||= /\{[^{}]*,[^{}]*\}/u.test(source.slice(start, i + 1));
      append("brace", c, false, i, i + 1);
    } else append("literal", c, false, i, i + 1);
    value += c;
    i += 1;
  }
  if (i === start) return undefined;
  return { word: { value, expanded, nested, parts, start, end: i }, start, end: i };
}

function matching(source: string, opening: number, left: string, right: string): number {
  let depth = 0;
  let quote = "";
  for (let i = opening; i < source.length; i += 1) {
    const c = source[i] ?? "";
    if (c === "\\" && quote !== "'") {
      i += 1;
      continue;
    }
    if ((c === "'" || c === '"') && (!quote || quote === c)) {
      quote = quote ? "" : c;
      continue;
    }
    if (quote) continue;
    if (c === left) depth += 1;
    if (c === right && --depth === 0) return i;
  }
  throw new BashParseError("unclosed expansion");
}
