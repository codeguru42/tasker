export interface BashWord {
  value: string;
  expanded: boolean;
  nested: BashCommand[];
}

export interface BashCommand {
  words: BashWord[];
  inputFromPipeline: boolean;
}

export interface ParsedBashLine {
  commands: BashCommand[];
}

export class BashParseError extends Error {}

export function parseBashCommand(command: string): ParsedBashLine {
  const lines: ParsedBashLine = { commands: [] };
  parseInto(maskQuotedHereDocBodies(command), lines);
  return lines;
}

function maskQuotedHereDocBodies(source: string): string {
  const lines = source.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index] ?? "";
    const match = /<<-?\s*(['"])([^'"\s]+)\1/.exec(header);
    if (match === null) continue;
    const delimiter = match[2] ?? "";
    for (let body = index + 1; body < lines.length; body += 1) {
      if ((lines[body] ?? "").trim() === delimiter) {
        for (let masked = index + 1; masked < body; masked += 1) lines[masked] = "";
        index = body;
        break;
      }
    }
  }
  return lines.join("\n");
}

function parseInto(source: string, output: ParsedBashLine): void {
  let commandWords: BashWord[] = [];
  let word = "";
  let value = "";
  let quoted = false;
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let parens = 0;
  let braceExpansion = false;
  let nextCommandReadsPipe = false;
  const nested: BashCommand[] = [];

  const finishWord = () => {
    if (word.length === 0) return;
    if (braceExpansion && /\{[^{}]*,[^{}]*\}/.test(word)) quoted = true;
    commandWords.push({ value, expanded: quoted, nested: [...nested] });
    word = "";
    value = "";
    quoted = false;
    braceExpansion = false;
    nested.length = 0;
  };
  const finishCommand = () => {
    finishWord();
    if (commandWords.length > 0) {
      output.commands.push({ words: commandWords, inputFromPipeline: nextCommandReadsPipe });
      nextCommandReadsPipe = false;
    }
    commandWords = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (escaped) {
      word += char;
      value += char;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      word += char;
      if (char === "'") quote = undefined;
      else value += char;
      continue;
    }
    if (char === "\\") {
      word += char;
      escaped = true;
      continue;
    }
    if (char === "'" || char === '"') {
      word += char;
      if (quote === undefined) quote = char;
      else if (quote === char) quote = undefined;
      continue;
    }
    if (quote === undefined && char === "`") {
      const end = source.indexOf("`", index + 1);
      if (end < 0) throw new BashParseError("unclosed backtick substitution");
      const content = source.slice(index + 1, end);
      nested.push(...parseBashCommand(content).commands);
      quoted = true;
      word += source.slice(index, end + 1);
      index = end;
      continue;
    }
    if (quote === undefined && (char === "<" || char === ">") && next === "(") {
      const end = matchingParen(source, index + 1);
      nested.push(...parseBashCommand(source.slice(index + 2, end)).commands);
      quoted = true;
      word += source.slice(index, end + 1);
      index = end;
      continue;
    }
    if (char === "$") {
      if (next === "(") {
        const end = matchingParen(source, index + 1);
        nested.push(...parseBashCommand(source.slice(index + 2, end)).commands);
        quoted = true;
        word += source.slice(index, end + 1);
        index = end;
        continue;
      }
      if (next === "{") {
        const end = matchingBrace(source, index + 1);
        const expansion = source.slice(index, end + 1);
        for (const content of substitutions(expansion)) nested.push(...parseBashCommand(content).commands);
        quoted = true;
        word += expansion;
        index = end;
        continue;
      }
      if (/[A-Za-z0-9_@*?$#!-]/.test(next)) quoted = true;
    }
    if (quote === undefined && char === "{" && next !== "") braceExpansion = true;
    if (quote === undefined && (char === "[" || char === "*")) quoted = true;

    if (quote === undefined && /\s/.test(char)) {
      finishWord();
      continue;
    }
    if (quote === undefined && (char === ";" || char === "|" || char === "&" || char === "\n")) {
      finishCommand();
      if (char === "|" && next !== "|") nextCommandReadsPipe = true;
      if (char === "|" && next === "|") index += 1;
      if (char === "&" && next === "&") index += 1;
      continue;
    }
    if (quote === undefined && char === "{" && word.length === 0 && /\s/.test(next)) {
      finishCommand();
      continue;
    }
    if (quote === undefined && char === "}" && word.length === 0 && (next === "" || /[\s;|&]/.test(next))) {
      finishCommand();
      continue;
    }
    if (quote === undefined && char === "(") {
      if (word.length > 0) finishWord();
      parens += 1;
      continue;
    }
    if (quote === undefined && char === ")") {
      if (parens === 0) throw new BashParseError("unexpected closing parenthesis");
      finishWord();
      parens -= 1;
      continue;
    }
    word += char;
    if (quote === undefined) value += char;
    else if (quote === '"') value += char;
  }
  if (escaped || quote !== undefined || parens !== 0) throw new BashParseError("unfinished shell syntax");
  finishCommand();
}

function matchingParen(source: string, start: number): number {
  let depth = 0;
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === "'" || char === '"') && (quote === undefined || quote === char)) {
      quote = quote === undefined ? char : undefined;
      continue;
    }
    if (quote !== undefined) continue;
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new BashParseError("unclosed command substitution");
}

function matchingBrace(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new BashParseError("unclosed parameter expansion");
}

function substitutions(source: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < source.length - 1; index += 1) {
    if (source[index] === "$" && source[index + 1] === "(") {
      const end = matchingParen(source, index + 1);
      found.push(source.slice(index + 2, end));
      index = end;
    }
  }
  return found;
}
