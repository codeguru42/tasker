import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface GitResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface CloneInfo {
  root: string;
  slug: string;
}

interface CliArgs {
  command: "scan" | "store";
  store: string;
  out: string;
  transcripts: string;
  ids: string[];
}

type TranscriptRow = Record<string, unknown>;

interface ToolCall {
  toolUseId: string;
  tool: string | null;
  sessionId: string | null;
  sessionName: string;
  input: unknown;
  permissionMode: string | null;
  assistantText: string;
  rowIndex: number;
  timestamp: string | null;
  model: string | null;
  outcome: string;
  cwd: string;
  form: ParsedForm | null;
}

interface ComparisonCall {
  kinds: string[];
  writeKeys: string[];
  outcome: string;
}

interface ParsedForm {
  plain: boolean;
  kinds: string[];
  outsidePaths: string[];
  parts: ParsedPart[];
}

interface ParsedPart {
  text: string;
  key: string | null;
  write: boolean;
  allowRule: string | null;
}

interface LaterTry {
  time: string;
  sessionName: string;
  sessionId: string | null;
  match: "same text" | "same write";
  command: string | null;
  outcome: string;
}

interface SettingsInfo {
  readAt: string;
  files: string[];
}

interface SettingsSnapshot {
  readAt: string;
  files: string[];
  rules: string[];
}

type OutcomeCounts = Record<string, number>;

interface Comparison {
  form: OutcomeCounts;
  writeKeys: Record<string, OutcomeCounts>;
}

interface DenialRecord {
  id: string;
  sessionId: string | null;
  sessionName: string | null;
  timestamp: string | null;
  cwd: string | null;
  permissionMode: string | null;
  tool: string | null;
  toolUseId: string | null;
  input: unknown;
  denial: string;
  form: ParsedForm | null;
  comparison: Comparison | null;
  laterTries: LaterTry[];
  comparisonCalls?: ComparisonCall[];
  settings: SettingsInfo | null;
  otherProject: boolean;
  assistantText: string | null;
  transcript: string;
  sessionKind: "main" | "subagent";
  model: string | null;
  gitBranch: string | null;
  claudeCodeVersion: string | null;
  reason: string | null;
  decision: string | null;
  reasonType: string | null;
  reasonCode: string | null;
  classifierCategory: string | null;
  toolDenialKind: string | null;
  agentId: string | null;
  mainSession: { name: string; role: string } | null;
}

class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

const usage = [
  "usage: node scripts/denial-records.ts scan --store <file> --out <folder> [--transcripts <folder>]",
  "       node scripts/denial-records.ts store --store <file> --out <folder> <record id>...",
];

function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (result.error) {
    return { code: null, stdout: "", stderr: result.error.message };
  }
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function gitOutput(args: string[], cwd: string): string {
  const result = runGit(args, cwd);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed with exit code ${String(result.code)}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function getCloneInfo(): CloneInfo {
  const scriptFolder = dirname(fileURLToPath(import.meta.url));
  const root = gitOutput(["rev-parse", "--show-toplevel"], scriptFolder);
  const origin = gitOutput(["remote", "get-url", "origin"], root);
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(
    origin,
  );
  if (!match) {
    throw new Error(`origin is not a supported GitHub URL: ${origin}`);
  }
  return { root, slug: `${match[1]}/${match[2]}` };
}

function parseArgs(args: string[]): CliArgs {
  const command = args[0];
  if (command !== "scan" && command !== "store") {
    throw new CliError("invalid command", 2);
  }
  let store: string | undefined;
  let out: string | undefined;
  let transcripts: string | undefined;
  const ids: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (
      (arg === "--store" || arg === "--out" || arg === "--transcripts") &&
      args[index + 1] &&
      !args[index + 1].startsWith("--")
    ) {
      if (arg === "--store") {
        if (store !== undefined) throw new CliError("--store can appear only once", 2);
        store = args[index + 1];
      } else {
        if (arg === "--out") {
          if (out !== undefined) throw new CliError("--out can appear only once", 2);
          out = args[index + 1];
        } else {
          if (transcripts !== undefined) throw new CliError("--transcripts can appear only once", 2);
          transcripts = args[index + 1];
        }
      }
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new CliError(`invalid argument: ${arg}`, 2);
    } else {
      ids.push(arg);
    }
  }
  if (!store || !out) throw new CliError("--store and --out are required", 2);
  if (command === "scan" && ids.length > 0) throw new CliError("scan takes no record ids", 2);
  if (command === "store" && ids.length === 0) throw new CliError("store needs at least one record id", 2);
  return {
    command,
    store: resolve(store),
    out: resolve(out),
    transcripts: resolve(transcripts ?? join(process.env.HOME ?? "", ".claude", "projects")),
    ids,
  };
}

function nearestExistingAncestor(path: string): string {
  let current = path;
  while (!existsSync(current) || !statSync(current).isDirectory()) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function isOutsideGit(path: string): boolean {
  const result = runGit(["-C", path, "rev-parse", "--is-inside-work-tree"], dirname(path));
  if (result.code === 0 && (result.stdout.trim() === "true" || result.stdout.trim() === "false")) {
    return false;
  }
  if (result.code === 128 && /not a git repository/i.test(result.stderr)) {
    return true;
  }
  throw new Error(
    `git rev-parse --is-inside-work-tree failed for ${path} with exit code ${String(result.code)}: ${result.stderr.trim()}`,
  );
}

function validatePaths(args: CliArgs): void {
  const records = resolve(args.out, "records.jsonl");
  if (args.store === records) throw new CliError("store and output records file cannot be the same path", 2);
  for (const path of [args.store, args.out]) {
    const ancestor = nearestExistingAncestor(path);
    if (!isOutsideGit(ancestor)) {
      throw new CliError(`path must be outside a git work tree: ${path}`, 2);
    }
  }
}

function parseJsonObject(line: string): TranscriptRow | null {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return removeClassifierFields(value) as TranscriptRow;
    }
  } catch {
    return null;
  }
  return null;
}

function removeClassifierFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeClassifierFields);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "serverClassifierContext" && key !== "serverClassifierRequest")
      .map(([key, item]) => [key, removeClassifierFields(item)]),
  );
}

function readJsonLines(path: string, strict = false): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (line.trim() === "") continue;
    const row = parseJsonObject(line);
    if (row !== null) {
      rows.push(row);
    } else if (strict) {
      throw new Error(`${path} has an invalid JSON object on line ${index + 1}`);
    }
  }
  return rows;
}

function eligibleCwd(cwd: unknown, root: string): cwd is string {
  if (typeof cwd !== "string" || cwd === "") return false;
  const path = resolve(cwd);
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function transcriptFiles(projectFolder: string): string[] {
  return readdirSync(projectFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(projectFolder, entry.name));
}

function readMetadata(path: string): TranscriptRow | null {
  if (!existsSync(path)) return null;
  return parseJsonObject(readFileSync(path, "utf8"));
}

function textOfBlock(block: unknown): string | null {
  if (typeof block === "string") return block;
  if (typeof block !== "object" || block === null) return null;
  const value = block as TranscriptRow;
  if (typeof value.text === "string") return value.text;
  if (Array.isArray(value.content))
    return value.content
      .map((item) =>
        typeof item === "object" && item !== null && typeof (item as TranscriptRow).text === "string"
          ? ((item as TranscriptRow).text as string)
          : "",
      )
      .filter(Boolean)
      .join("\n");
  if (typeof value.content === "string") return value.content;
  return null;
}

function resultBlocks(row: TranscriptRow): TranscriptRow[] {
  if (row.type !== "user") return [];
  const message = row.message;
  if (typeof message !== "object" || message === null) return [];
  const content = (message as TranscriptRow).content;
  if (!Array.isArray(content)) return [];
  return content.filter(
    (block): block is TranscriptRow => typeof block === "object" && block !== null && !Array.isArray(block),
  );
}

function denialText(block: TranscriptRow, row: TranscriptRow): string | null {
  if (block.type !== "tool_result") return null;
  const text = textOfBlock(block);
  if (text === null) return null;
  const decision = row.permissionDecision;
  const isDecisionDenial =
    typeof decision === "object" &&
    decision !== null &&
    (decision as TranscriptRow).decision === "reject" &&
    (decision as TranscriptRow).reasonType === "classifier";
  const isClassifierError =
    block.is_error === true &&
    (text.startsWith("Permission for this action was denied by the Claude Code auto mode classifier") ||
      text.startsWith("The server-side auto mode classifier gave no verdict"));
  if (isDecisionDenial || isClassifierError) {
    return text;
  }
  return null;
}

function stripHeredocBodies(command: string): string {
  const kept: string[] = [];
  let delimiters: string[] = [];
  for (const line of command.split("\n")) {
    if (delimiters.length > 0) {
      const delimiter = delimiters[0];
      if (line.trim() === delimiter) delimiters = delimiters.slice(1);
      continue;
    }
    kept.push(line);
    const matches = [...line.matchAll(/<<-?\s*(?:'([^']+)'|"([^"]+)"|([^\s;|&]+))/g)];
    delimiters = matches.map((match) => match[1] ?? match[2] ?? match[3]);
  }
  return kept.join("\n");
}

function commandWords(text: string): string[] {
  const words: string[] = [];
  const pattern = /(?:"(?:\\.|[^"\\])*"|'[^']*'|`[^`]*`|\$\([^)]*\)|[^\s]+)/g;
  for (const match of text.matchAll(pattern)) words.push(match[0]);
  return words;
}

function splitCommand(command: string): { parts: string[]; operators: string[]; substitutions: string[] } {
  const parts: string[] = [];
  const operators: string[] = [];
  const substitutions: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote === "'") {
      current += char;
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      current += char;
      if (char === '"') quote = null;
      if (char === "$" && command[i + 1] === "(") {
        const start = i;
        let depth = 1;
        let end = i + 2;
        while (end < command.length && depth > 0) {
          if (command[end] === "(") depth += 1;
          if (command[end] === ")") depth -= 1;
          end += 1;
        }
        const inner = command.slice(start + 2, end - 1);
        substitutions.push(inner);
        current = current.slice(0, -1) + command.slice(start, end);
        i = end - 1;
      }
      continue;
    }
    if (quote === "`") {
      if (char === "`") {
        quote = null;
        current += char;
      } else current += char;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      if (char === "`") {
        const end = command.indexOf("`", i + 1);
        if (end >= 0) {
          substitutions.push(command.slice(i + 1, end));
          current += command.slice(i + 1, end + 1);
          i = end;
          quote = null;
        }
      }
      continue;
    }
    if (char === "$" && command[i + 1] === "(") {
      const start = i + 2;
      let depth = 1;
      i += 1;
      while (++i < command.length && depth > 0) {
        if (command[i] === "(") depth += 1;
        if (command[i] === ")") depth -= 1;
      }
      const inner = command.slice(start, i);
      substitutions.push(inner);
      current += `$(${inner})`;
      continue;
    }
    const op = command.startsWith("&&", i)
      ? "&&"
      : command.startsWith("||", i)
        ? "||"
        : [";", "|", "\n"].includes(char)
          ? char
          : null;
    if (op !== null) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      operators.push(op === "|" ? "pipe" : op === "\n" ? ";" : op);
      if (op.length === 2) i += 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return { parts, operators, substitutions };
}

function pathValue(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~") || value.startsWith("$HOME") || value.startsWith("..");
}

function isOutsidePath(value: string, cwd: string): boolean {
  const home = process.env.HOME ?? "";
  const expanded = value.startsWith("$HOME")
    ? join(home, value.slice(5))
    : value.startsWith("~")
      ? join(home, value.slice(1))
      : value;
  const absolute = expanded.startsWith("/") ? resolve(expanded) : resolve(cwd, expanded);
  const relativePath = relative(resolve(cwd), absolute);
  return relativePath === ".." || relativePath.startsWith(`..${sep}`);
}

function partKey(text: string): string | null {
  const words = commandWords(text);
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index += 1;
  if (words[index] === "git" && words[index + 1] === "-C" && words[index + 2] !== undefined) words.splice(index + 1, 2);
  while (["if", "then", "else", "elif", "fi", "do", "done", "!"].includes(words[index])) index += 1;
  const key: string[] = [];
  for (; index < words.length; index += 1) {
    if (words[index].startsWith("-")) break;
    key.push(words[index].replace(/^['"]|['"]$/g, ""));
  }
  if (key.length === 0 || key[0] === "for" || key[0] === "while") return null;
  return key.join(" ");
}

function partWrites(text: string, key: string | null): boolean {
  if (key === null) return false;
  if (/^git push(?:\s|$)/.test(key)) return true;
  if (
    /^tasker\s+(?:start|plan|refine|approve|execute|verify|review|retry|accept|reopen|open-pr|merge|push|mark-landed)(?:\s|$)/.test(
      key,
    )
  )
    return true;
  if (
    /^gh\s+(?:issue|pr|repo|release)\s+(?:comment|edit|close|create|delete|merge|ready|reopen|label|lock|unlock|review|submit-review|create|delete)(?:\s|$)/.test(
      key,
    )
  )
    return true;
  if (/^gh\s+api(?:\s|$)/.test(key)) {
    if (/\bgraphql\b/.test(text)) return /\bmutation\b/.test(text);
    const method = /(?:^|\s)(?:-X|--method)\s+(\w+)/i.exec(text)?.[1]?.toUpperCase();
    if (method === "GET") return false;
    if (method && method !== "POST") return true;
    return /(?:^|\s)(?:-f|--field|-F|--raw-field)\s*\S/.test(text);
  }
  return false;
}

function parseBash(command: string, cwd: string, settings?: SettingsSnapshot, depth = 0): ParsedForm {
  const source = stripHeredocBodies(command);
  const split = splitCommand(source);
  const kinds = new Set<string>();
  const parts: ParsedPart[] = [];
  const paths: string[] = [];
  for (const op of split.operators) kinds.add(op);
  if (/\bfor\s+\w+\s+in\b/.test(source)) kinds.add("loop");
  if (/\bif\b/.test(source)) kinds.add("if");
  if (source.includes("$(")) kinds.add("$(...)");
  if (/(?:^|\s)(?:>>?|<<?|2>|&>)/.test(source)) kinds.add("redirect");
  if (/(?:^|[;&|]\s*)cd(?:\s|$)/.test(source)) kinds.add("cd");
  const variableSource = /\bfor\s+n\s+in\b/.test(source) ? source.replace(/\$n\b/g, "") : source;
  if (
    /\$[A-Za-z_{]/.test(variableSource) ||
    /(?:^|&&\s*|;\s*)[A-Za-z_][A-Za-z0-9_]*=[^\s;&|]+(?=\s|$|;)/.test(variableSource)
  )
    kinds.add("variable");
  for (const chunk of split.parts) {
    const key = partKey(chunk);
    const write = partWrites(chunk, key);
    const allowRule = key && settings ? (settings.rules.find((rule) => matchesBashRule(rule, chunk)) ?? null) : null;
    parts.push({ text: chunk, key, write, allowRule });
    const visible = chunk.replace(
      /'([^']*)'|"([^"]*)"/g,
      (_match, single: string | undefined, double: string | undefined) => single ?? double ?? "",
    );
    const candidates =
      visible.match(/(?:^|\s)(\/[^\s'"<>|;&]+|~[^\s'"<>|;&]*|\$HOME[^\s'"<>|;&]*|\.\.[^\s'"<>|;&]*)/g) ?? [];
    for (const found of candidates) {
      const value = found.trim().replace(/^['"]|['"]$/g, "");
      if (value !== "/dev/null" && pathValue(value) && isOutsidePath(value, cwd) && !paths.includes(value))
        paths.push(value);
    }
    for (const word of commandWords(chunk)) {
      const assignment = /^[A-Za-z_][A-Za-z0-9_]*=(.*)$/.exec(word);
      if (
        assignment &&
        pathValue(assignment[1]) &&
        assignment[1] !== "/dev/null" &&
        isOutsidePath(assignment[1], cwd) &&
        !paths.includes(assignment[1])
      )
        paths.push(assignment[1]);
    }
  }
  if (paths.length) kinds.add("outside path");
  if (depth < 5)
    for (const nested of split.substitutions) {
      const inner = parseBash(nested, cwd, settings, depth + 1);
      for (const item of inner.kinds) kinds.add(item);
      parts.push(...inner.parts);
      for (const path of inner.outsidePaths) if (!paths.includes(path)) paths.push(path);
    }
  const order = ["&&", "||", ";", "pipe", "loop", "if", "$(...)", "redirect", "cd", "variable", "outside path"];
  const orderedKinds = order.filter((kind) => kinds.has(kind));
  return { plain: orderedKinds.length === 0, kinds: orderedKinds, outsidePaths: paths, parts };
}

function formWriteKeys(form: ParsedForm): string[] {
  return [...new Set(form.parts.filter((part) => part.write && part.key !== null).map((part) => part.key!))];
}

function loadSettings(home: string, root: string): SettingsSnapshot {
  const candidates = [
    join(home, ".claude", "settings.json"),
    join(root, ".claude", "settings.json"),
    join(root, ".claude", "settings.local.json"),
  ];
  const files: string[] = [];
  const rules: string[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const config: unknown = JSON.parse(readFileSync(path, "utf8"));
      files.push(path);
      if (typeof config !== "object" || config === null) continue;
      const permissions = (config as TranscriptRow).permissions;
      if (typeof permissions !== "object" || permissions === null) continue;
      const allow = (permissions as TranscriptRow).allow;
      if (Array.isArray(allow)) rules.push(...allow.filter((rule): rule is string => typeof rule === "string"));
    } catch {
      continue;
    }
  }
  return { readAt: new Date().toISOString(), files, rules };
}

function settingsInfo(snapshot: SettingsSnapshot): SettingsInfo {
  return { readAt: snapshot.readAt, files: snapshot.files };
}

function matchesBashRule(rule: string, command: string): boolean {
  const match = /^Bash\((.*)\)$/.exec(rule);
  if (!match) return false;
  const source = match[1].replace(/:\*$/, " *");
  const pattern = source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${pattern}$`).test(command);
}

function otherProject(command: string, slug: string): boolean {
  const found: string[] = [];
  const repoFlag = /(?:--repo\s+|--repo=|-R\s*|^-R)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g;
  for (const match of command.matchAll(repoFlag)) found.push(match[1]);
  const apiRepo = /\bgh\s+api\s+repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g;
  for (const match of command.matchAll(apiRepo)) found.push(match[1]);
  return found.some((repo) => repo.toLowerCase() !== slug.toLowerCase());
}

function callsInTranscript(
  rows: TranscriptRow[],
  sessionName = "-",
  eligibleFolderCwd = "",
  settings?: SettingsSnapshot,
): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>();
  const outcomes = permissionOutcomes(rows);
  let assistantText = "";
  let mode: string | null = null;
  for (const [rowIndex, row] of rows.entries()) {
    if (row.type === "user") assistantText = "";
    if (row.type === "permission-mode") {
      const value = row.permissionMode;
      if (typeof value === "string") mode = value;
      continue;
    }
    if (row.type === "agent-name" || row.type === "custom-title") continue;
    if (row.type !== "assistant") continue;
    const message = row.message;
    if (typeof message !== "object" || message === null) continue;
    const content = (message as TranscriptRow).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block !== "object" || block === null || Array.isArray(block)) continue;
      const item = block as TranscriptRow;
      if (item.type === "text" && typeof item.text === "string") {
        assistantText += `${assistantText === "" ? "" : "\n"}${item.text}`;
      } else if (item.type === "tool_use" && typeof item.id === "string") {
        if (calls.has(item.id)) continue;
        const callSessionId = typeof row.sessionId === "string" ? row.sessionId : null;
        calls.set(item.id, {
          toolUseId: item.id,
          tool: typeof item.name === "string" ? item.name : null,
          sessionId: callSessionId,
          sessionName,
          input: item.input ?? null,
          permissionMode: typeof row.permissionMode === "string" ? row.permissionMode : mode,
          assistantText: assistantText || "",
          rowIndex,
          timestamp: typeof row.timestamp === "string" ? row.timestamp : null,
          model:
            typeof (message as TranscriptRow).model === "string" ? ((message as TranscriptRow).model as string) : null,
          outcome: outcomes.get(item.id) ?? "no result",
          cwd: typeof row.cwd === "string" ? row.cwd : eligibleFolderCwd,
          form:
            item.name === "Bash" && typeof item.input === "object" && item.input !== null
              ? parseBash(
                  typeof (item.input as TranscriptRow).command === "string"
                    ? ((item.input as TranscriptRow).command as string)
                    : "",
                  typeof row.cwd === "string" ? row.cwd : eligibleFolderCwd,
                  settings,
                )
              : null,
        });
      }
    }
  }
  return calls;
}

function permissionOutcomes(rows: TranscriptRow[]): Map<string, string> {
  const outcomes = new Map<string, string>();
  for (const row of rows) {
    if (row.type !== "user") continue;
    for (const block of resultBlocks(row)) {
      if (block.type !== "tool_result") continue;
      if (typeof block.tool_use_id !== "string") continue;
      const denial = denialText(block, row);
      const decision = row.permissionDecision;
      const decisionRow = typeof decision === "object" && decision !== null ? (decision as TranscriptRow) : {};
      const decisionValue = typeof decisionRow.decision === "string" ? decisionRow.decision : "reject";
      const reasonValue = typeof decisionRow.reasonType === "string" ? decisionRow.reasonType : "classifier";
      if (denial !== null) outcomes.set(block.tool_use_id, `${decisionValue}/${reasonValue}`);
      else if (
        typeof decision === "object" &&
        decision !== null &&
        typeof (decision as TranscriptRow).decision === "string"
      )
        outcomes.set(
          block.tool_use_id,
          `${decisionRow.decision as string}/${typeof decisionRow.reasonType === "string" ? decisionRow.reasonType : "-"}`,
        );
      else if (outcomes.get(block.tool_use_id) === undefined) outcomes.set(block.tool_use_id, "unknown");
    }
  }
  return outcomes;
}

function writeKeysForCall(call: ToolCall): string[] {
  if (call.tool !== "Bash" || typeof call.input !== "object" || call.input === null) return [];
  return call.form === null ? [] : formWriteKeys(call.form);
}

function laterTries(calls: ToolCall[], deniedCall: ToolCall, limit = 10): LaterTry[] {
  const deniedInput =
    typeof deniedCall.input === "object" && deniedCall.input !== null ? (deniedCall.input as TranscriptRow) : {};
  const deniedCommand = typeof deniedInput.command === "string" ? deniedInput.command : "";
  const deniedWrites = new Set(writeKeysForCall(deniedCall));
  return calls
    .filter(
      (call) =>
        call.tool === "Bash" &&
        call.toolUseId !== deniedCall.toolUseId &&
        (call.timestamp ?? "") > (deniedCall.timestamp ?? ""),
    )
    .map((call) => {
      const input = typeof call.input === "object" && call.input !== null ? (call.input as TranscriptRow) : {};
      const command = typeof input.command === "string" ? input.command : "";
      const writes = writeKeysForCall(call);
      const sameWrite = writes.some((key) => deniedWrites.has(key));
      const match: LaterTry["match"] | null = command === deniedCommand ? "same text" : sameWrite ? "same write" : null;
      if (match === null) return null;
      return {
        time: call.timestamp ?? "",
        sessionName: call.sessionName,
        sessionId: call.sessionId,
        command: match === "same text" ? null : command,
        outcome: call.outcome,
        match,
        rowIndex: call.rowIndex,
      };
    })
    .filter((attempt): attempt is NonNullable<typeof attempt> => attempt !== null)
    .sort((a, b) => a.time.localeCompare(b.time) || a.rowIndex - b.rowIndex)
    .slice(0, limit)
    .map((attempt) => ({
      time: attempt.time,
      sessionName: attempt.sessionName,
      sessionId: attempt.sessionId,
      match: attempt.match,
      command: attempt.command,
      outcome: attempt.outcome,
    }));
}

function emptyCounts(): OutcomeCounts {
  return {};
}

function comparisonCounts(records: DenialRecord[]): void {
  for (const record of records) {
    if (record.form === null || record.comparison === null) continue;
    const formCounts: OutcomeCounts = {};
    const writeCounts: Record<string, OutcomeCounts> = {};
    const deniedKeys = formWriteKeys(record.form);
    const deniedKinds = record.form.kinds;
    for (const call of record.comparisonCalls ?? []) {
      if (call.kinds.length === deniedKinds.length && call.kinds.every((kind, index) => kind === deniedKinds[index])) {
        formCounts[call.outcome] = (formCounts[call.outcome] ?? 0) + 1;
      }
      for (const key of deniedKeys) {
        if (!call.writeKeys.includes(key)) continue;
        writeCounts[key] ??= emptyCounts();
        writeCounts[key][call.outcome] = (writeCounts[key][call.outcome] ?? 0) + 1;
      }
    }
    record.comparison = { form: formCounts, writeKeys: writeCounts };
  }
}

function recordDenials(
  rows: TranscriptRow[],
  calls: Map<string, ToolCall>,
  source: string,
  sessionName: string | null,
  eligibleFolderCwd: string,
  settings: SettingsSnapshot,
  slug: string,
  allCalls: ToolCall[],
  comparisonCalls: ComparisonCall[],
  agentId: string | null = null,
  sessionKind: "main" | "subagent" = "main",
  mainSession: { name: string; role: string } | null = null,
): DenialRecord[] {
  const records: DenialRecord[] = [];
  for (const row of rows) {
    for (const block of resultBlocks(row)) {
      const denial = denialText(block, row);
      if (denial === null) continue;
      const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : null;
      const call = toolUseId === null ? undefined : calls.get(toolUseId);
      if (call === undefined) continue;
      const bashInput =
        call?.tool === "Bash" && typeof call.input === "object" && call.input !== null
          ? (call.input as TranscriptRow)
          : null;
      const command = typeof bashInput?.command === "string" ? bashInput.command : "";
      const form = call?.tool === "Bash" ? call.form : null;
      const callSettings = call?.tool === "Bash" ? settingsInfo(settings) : null;
      const sessionId = typeof row.sessionId === "string" ? row.sessionId : null;
      const id = `${sessionId ?? "unknown"}:${toolUseId ?? "unknown"}`;
      records.push({
        id,
        sessionId,
        sessionName: sessionName ?? "-",
        timestamp: typeof row.timestamp === "string" ? row.timestamp : null,
        cwd: typeof row.cwd === "string" ? row.cwd : eligibleFolderCwd,
        permissionMode: call?.permissionMode ?? null,
        tool: call?.tool ?? null,
        toolUseId,
        input: call?.input ?? null,
        denial,
        form,
        comparison: form === null ? null : { form: {}, writeKeys: {} },
        laterTries: call?.tool === "Bash" ? laterTries(allCalls, call) : [],
        comparisonCalls: call?.tool === "Bash" ? comparisonCalls : [],
        settings: callSettings,
        otherProject: call?.tool === "Bash" && otherProject(command, slug),
        assistantText: call?.assistantText ?? null,
        transcript: source,
        sessionKind,
        model: call.model,
        gitBranch: typeof row.gitBranch === "string" ? row.gitBranch : null,
        claudeCodeVersion: typeof row.version === "string" ? row.version : null,
        reason: denial.includes("Reason: ") ? denial.slice(denial.indexOf("Reason: ") + 8).trim() : null,
        decision:
          typeof row.permissionDecision === "object" &&
          row.permissionDecision !== null &&
          typeof (row.permissionDecision as TranscriptRow).decision === "string"
            ? ((row.permissionDecision as TranscriptRow).decision as string)
            : null,
        reasonType:
          typeof row.permissionDecision === "object" &&
          row.permissionDecision !== null &&
          typeof (row.permissionDecision as TranscriptRow).reasonType === "string"
            ? ((row.permissionDecision as TranscriptRow).reasonType as string)
            : null,
        reasonCode:
          typeof row.permissionDecision === "object" &&
          row.permissionDecision !== null &&
          typeof (row.permissionDecision as TranscriptRow).reasonCode === "string"
            ? ((row.permissionDecision as TranscriptRow).reasonCode as string)
            : null,
        classifierCategory:
          typeof row.permissionDecision === "object" &&
          row.permissionDecision !== null &&
          typeof (row.permissionDecision as TranscriptRow).classifierCategory === "string"
            ? ((row.permissionDecision as TranscriptRow).classifierCategory as string)
            : null,
        toolDenialKind: typeof row.toolDenialKind === "string" ? row.toolDenialKind : null,
        agentId,
        mainSession,
      });
    }
  }
  return records;
}

interface TranscriptData {
  rows: TranscriptRow[];
  source: string;
  name: string;
  cwd: string;
  agentId: string | null;
  kind: "main" | "subagent";
  mainSession: { name: string; role: string } | null;
}

function readSubagentTranscripts(
  projectFolder: string,
  eligibleFolderCwd: string,
  mainTranscript: string,
  mainName: string,
): TranscriptData[] {
  const subagentFolder = join(projectFolder, basename(mainTranscript, ".jsonl"), "subagents");
  const paths: string[] = [];
  if (existsSync(subagentFolder) && statSync(subagentFolder).isDirectory())
    paths.push(
      ...readdirSync(subagentFolder, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => join(subagentFolder, entry.name)),
    );
  const transcripts: TranscriptData[] = [];
  for (const path of paths) {
    const rows = readJsonLines(path);
    const agentId = basename(path)
      .replace(/^agent-/, "")
      .replace(/\.jsonl$/, "");
    const metadata = readMetadata(path.replace(/\.jsonl$/, ".meta.json"));
    const name = typeof metadata?.name === "string" ? metadata.name : "-";
    transcripts.push({
      rows,
      source: relative(dirname(mainTranscript), path),
      name,
      cwd: eligibleFolderCwd,
      agentId,
      kind: "subagent",
      mainSession: { name: mainName, role: /^[A-Za-z]+-/.test(mainName) ? mainName.split("-")[0] : "-" },
    });
  }
  return transcripts;
}

function mainSessionName(rows: TranscriptRow[]): string {
  const valid = (value: unknown): value is string => typeof value === "string" && value.trim() !== "" && value !== "-";
  const agentName = rows
    .filter((row) => row.type === "agent-name")
    .map((row) => row.agentName)
    .filter(valid)
    .at(-1);
  if (agentName !== undefined) return agentName;
  return (
    rows
      .filter(
        (row) =>
          row.type === "custom-title" &&
          !(typeof row.customTitle === "string" && row.customTitle.startsWith("permission-mode:")),
      )
      .map((row) => row.customTitle)
      .filter(valid)
      .at(-1) ?? "-"
  );
}

function firstCwdLine(path: string): TranscriptRow | null {
  const descriptor = openSync(path, "r");
  try {
    const bytes = Buffer.alloc(64 * 1024);
    let pending = Buffer.alloc(0);
    while (true) {
      const count = readSync(descriptor, bytes, 0, bytes.length, null);
      if (count === 0) break;
      const chunk = Buffer.concat([pending, bytes.subarray(0, count)]);
      let start = 0;
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] !== 10) continue;
        const row = parseJsonObject(chunk.subarray(start, index).toString("utf8"));
        if (row && typeof row.cwd === "string") return row;
        start = index + 1;
      }
      pending = chunk.subarray(start);
    }
    const row = parseJsonObject(pending.toString("utf8"));
    return row && typeof row.cwd === "string" ? row : null;
  } finally {
    closeSync(descriptor);
  }
}

function scanTranscripts(transcripts: string, home: string, root: string, slug: string): DenialRecord[] {
  const projects = transcripts;
  if (!existsSync(projects) || !statSync(projects).isDirectory()) return [];
  const settings = loadSettings(home, root);
  const projectFolders = readdirSync(projects, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(projects, entry.name));
  const transcriptsToRead: TranscriptData[] = [];
  for (const projectFolder of projectFolders) {
    for (const path of transcriptFiles(projectFolder)) {
      const first = firstCwdLine(path);
      if (!eligibleCwd(first?.cwd, root)) continue;
      const rows = readJsonLines(path);
      const name = mainSessionName(rows);
      transcriptsToRead.push({
        rows,
        source: basename(path),
        name,
        cwd: first.cwd,
        agentId: null,
        kind: "main",
        mainSession: null,
      });
      transcriptsToRead.push(...readSubagentTranscripts(projectFolder, first.cwd, path, name));
    }
  }
  const callsByTranscript = transcriptsToRead.map((transcript) =>
    callsInTranscript(transcript.rows, transcript.name, transcript.cwd, settings),
  );
  const allCalls = [
    ...new Map(
      callsByTranscript.flatMap((calls) => [...calls.values()]).map((call) => [call.toolUseId, call] as const),
    ).values(),
  ];
  const comparisonCalls = allCalls
    .filter((call) => call.tool === "Bash")
    .map((call) => {
      const form = call.form;
      return form === null
        ? { kinds: [], writeKeys: [], outcome: call.outcome }
        : { kinds: form.kinds, writeKeys: formWriteKeys(form), outcome: call.outcome };
    });
  const records = transcriptsToRead.flatMap((transcript, index) =>
    recordDenials(
      transcript.rows,
      callsByTranscript[index],
      transcript.source,
      transcript.name,
      transcript.cwd,
      settings,
      slug,
      allCalls,
      comparisonCalls,
      transcript.agentId,
      transcript.kind,
      transcript.mainSession,
    ),
  );
  const earliest = new Map<string, DenialRecord>();
  for (const record of records) {
    const key = record.toolUseId ?? record.id;
    const existing = earliest.get(key);
    const time = record.timestamp ?? "";
    if (existing === undefined || time < (existing.timestamp ?? "")) earliest.set(key, record);
  }
  const sorted = [...earliest.values()].sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));
  comparisonCounts(sorted);
  return sorted;
}

function publicRecord(record: DenialRecord): TranscriptRow {
  const subagent = record.sessionKind === "subagent";
  const sessionName = record.sessionName ?? "-";
  const role = subagent ? "subagent" : /^[A-Za-z]+-/.test(sessionName) ? sessionName.split("-")[0] : "-";
  const callInput = typeof record.input === "object" && record.input !== null ? (record.input as TranscriptRow) : {};
  const input =
    record.tool === "Bash" ? { command: typeof callInput.command === "string" ? callInput.command : "" } : record.input;
  const reason = record.reason;
  const kind = record.denial.toLowerCase().includes("no verdict") ? "check failure" : "denial";
  return {
    schema: 1,
    id: record.toolUseId ?? record.id,
    time: record.timestamp,
    session: {
      name: sessionName,
      role,
      kind: subagent ? "subagent" : "main",
      sessionId: record.sessionId,
      agentId: record.agentId,
      transcript: record.transcript,
      mainSession: record.mainSession,
    },
    cwd: record.cwd,
    gitBranch: record.gitBranch,
    otherProject: record.otherProject,
    claudeCodeVersion: record.claudeCodeVersion,
    model: record.model,
    permissionMode: record.permissionMode,
    call: { tool: record.tool, input },
    denial: {
      kind,
      text: record.denial,
      reason,
      decision:
        record.decision === null
          ? null
          : {
              reasonType: record.reasonType,
              reasonCode: record.reasonCode,
              classifierCategory: record.classifierCategory,
            },
      toolDenialKind: record.toolDenialKind,
    },
    form: record.form,
    settings: record.settings,
    laterTries: record.laterTries,
    comparison: record.comparison,
    assistantText: record.assistantText,
  };
}

function redactString(value: string): string {
  let redacted = value.replace(/(https?:\/\/[^:/\s]+:)[^@/\s]+(@)/gi, "$1[redacted]$2");
  redacted = redacted.replace(
    /-----BEGIN [A-Za-z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Za-z0-9 ]*PRIVATE KEY-----|$)/g,
    "[redacted]",
  );
  redacted = redacted.replace(/(^|[^A-Za-z0-9_-])(Bearer |Basic )([A-Za-z0-9._~+/-]{8,}=*)/g, "$1$2[redacted]");
  const tokens = [
    "gh[pousr]_[A-Za-z0-9]{36,}",
    "github_pat_[A-Za-z0-9_]{22,}",
    "sk-(?:ant|or|proj|svcacct|admin)-[A-Za-z0-9_-]{20,}",
    "sk-[A-Za-z0-9]{32,}",
    "ATATT[A-Za-z0-9_=-]{20,}",
    "(?:AKIA|ASIA)[0-9A-Z]{16}",
    "xox[abeprs]-[A-Za-z0-9-]{10,}",
    "xapp-[A-Za-z0-9-]{10,}",
    "npm_[A-Za-z0-9]{36}",
    "AIza[A-Za-z0-9_-]{35}",
    "glpat-[A-Za-z0-9_-]{20,}",
    "eyJ[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
  ];
  redacted = redacted.replace(new RegExp(`(^|[^A-Za-z0-9_-])(${tokens.join("|")})`, "g"), "$1[redacted]");
  const secretName = "[A-Za-z0-9_-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|API-KEY|APIKEY)";
  const secretValue = "[A-Za-z0-9_./+=:-]{8,}";
  const assignment = new RegExp(`(^|[^A-Za-z0-9_-])(${secretName})(\\s*[:=]\\s*)(${secretValue})`, "gi");
  const quotedAssignment = new RegExp(`(^|[^A-Za-z0-9_-])(${secretName})(\\s*[:=]\\s*)(["'])(${secretValue})\\4`, "gi");
  const jsonPair = new RegExp(`(["'])(${secretName})\\1(\\s*:\\s*)(["'])(${secretValue})\\4`, "gi");
  redacted = redacted.replace(jsonPair, "$1$2$1$3$4[redacted]$4");
  redacted = redacted.replace(quotedAssignment, "$1$2$3$4[redacted]$4");
  redacted = redacted.replace(assignment, "$1$2$3[redacted]");
  const option = new RegExp(
    `(^|[^A-Za-z0-9_-])(--${secretName})(\\s+)(?:["'](${secretValue})["']|(${secretValue}))`,
    "gi",
  );
  return redacted.replace(option, "$1$2$3[redacted]");
}

function addCounts(target: TranscriptRow, value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  for (const [key, count] of Object.entries(value)) {
    if (typeof count !== "number") continue;
    const prior = target[key];
    target[key] = (typeof prior === "number" ? prior : 0) + count;
  }
}

function redactValue(value: unknown, keepId = false, context = ""): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value !== "object" || value === null) return value;
  const redacted: TranscriptRow = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const outputKey = keepId && key === "id" ? key : redactString(key);
    const itemContext =
      key === "comparison"
        ? "comparison"
        : context === "comparison" && key === "writeKeys"
          ? "comparison-write-keys"
          : "";
    const outputValue = keepId && key === "id" ? item : redactValue(item, false, itemContext);
    if (context === "comparison-write-keys" && Object.hasOwn(redacted, outputKey)) {
      addCounts(redacted[outputKey] as TranscriptRow, outputValue);
    } else if (!Object.hasOwn(redacted, outputKey)) {
      redacted[outputKey] = outputValue;
    }
  }
  return redacted;
}

function redactRecord(record: DenialRecord | TranscriptRow): TranscriptRow {
  return redactValue(record, true) as TranscriptRow;
}

function ensurePrivateFolder(path: string, setExistingMode: boolean): void {
  const missing: string[] = [];
  let current = path;
  while (!existsSync(current)) {
    missing.push(current);
    const parent = dirname(current);
    if (parent === current) throw new Error(`cannot find a parent folder for ${path}`);
    current = parent;
  }
  if (!statSync(current).isDirectory()) throw new Error(`${current} is not a folder`);
  for (const folder of missing.reverse()) {
    mkdirSync(folder, { mode: 0o700 });
    chmodSync(folder, 0o700);
  }
  if (setExistingMode) chmodSync(path, 0o700);
}

function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

// The store path, JSONL reads, selected-ID checks, and append steps stay together here.
function readRecordFile(path: string): TranscriptRow[] {
  if (!existsSync(path)) return [];
  const rows = readJsonLines(path, true);
  const missingIds = rows.filter((row) => typeof row.id !== "string");
  if (missingIds.length > 0) throw new Error(`${path} has a record with no string id`);
  return rows;
}

const recordKeys = [
  "schema",
  "id",
  "time",
  "session",
  "cwd",
  "gitBranch",
  "otherProject",
  "claudeCodeVersion",
  "model",
  "permissionMode",
  "call",
  "denial",
  "form",
  "settings",
  "laterTries",
  "comparison",
  "assistantText",
];

function validateRequestedIds(args: CliArgs, records: TranscriptRow[]): { id: string; line: string }[] {
  const byId = new Map<string, TranscriptRow>();
  for (const record of records) {
    if (typeof record.id === "string") byId.set(record.id, record);
  }
  const ids = [...new Set(args.ids)];
  const problems: string[] = [];
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) problems.push(`invalid requested id: ${id}`);
    const record = byId.get(id);
    if (record === undefined) {
      problems.push(`requested id was not found: ${id}`);
      continue;
    }
    if (record.schema !== 1) problems.push(`record ${id} has an unsupported schema`);
    const missing = recordKeys.filter((key) => !Object.hasOwn(record, key));
    if (missing.length > 0) problems.push(`record ${id} is missing required keys: ${missing.join(", ")}`);
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));
  return ids.map((id) => ({ id, line: JSON.stringify(redactRecord(byId.get(id)!)) }));
}

function storedIds(path: string): Set<string> {
  return new Set(readRecordFile(path).map((record) => record.id as string));
}

function appendSelectedRecords(
  args: CliArgs,
  selectedRecords: { id: string; line: string }[],
  already: Set<string>,
): void {
  const lines: string[] = [];
  for (const record of selectedRecords) {
    if (already.has(record.id)) {
      process.stdout.write(`${record.id} already stored\n`);
    } else {
      lines.push(record.line);
    }
  }
  if (lines.length === 0) {
    process.stdout.write("0 stored\n");
    return;
  }
  ensurePrivateFolder(dirname(args.store), false);
  const content = `${lines.join("\n")}\n`;
  if (existsSync(args.store)) {
    const existing = readFileSync(args.store, "utf8");
    if (existing !== "" && !existing.endsWith("\n")) appendFileSync(args.store, "\n");
    appendFileSync(args.store, content);
    chmodSync(args.store, 0o600);
  } else {
    writePrivateFile(args.store, content);
  }
  process.stdout.write(`${lines.length} stored\n`);
}

function store(args: CliArgs): void {
  const output = join(args.out, "records.jsonl");
  const records = readRecordFile(output);
  const already = storedIds(args.store);
  const selectedLines = validateRequestedIds(args, records);
  appendSelectedRecords(args, selectedLines, already);
}

function scan(args: CliArgs, root: string, slug: string): void {
  const existing = new Set(readRecordFile(args.store).map((record) => record.id as string));
  const records = scanTranscripts(args.transcripts, process.env.HOME ?? "", root, slug);
  const publicRecords = records.map((record) => redactRecord(publicRecord(record)));
  const fresh = publicRecords.filter((record) => !existing.has(String(record.id)));
  ensurePrivateFolder(args.out, true);
  const text = publicRecords.map((record) => JSON.stringify(record)).join("\n");
  writePrivateFile(join(args.out, "records.jsonl"), text === "" ? "" : `${text}\n`);
  for (const record of fresh) {
    const session =
      typeof record.session === "object" && record.session !== null ? (record.session as TranscriptRow) : {};
    const denial = typeof record.denial === "object" && record.denial !== null ? (record.denial as TranscriptRow) : {};
    const reason = typeof denial.reason === "string" ? denial.reason.split(/\r?\n/, 1)[0] : "-";
    const time = typeof record.time === "string" ? record.time : "-";
    const sessionName = typeof session.name === "string" ? session.name : "-";
    process.stdout.write(`${String(record.id)} ${time} ${sessionName} ${reason}\n`);
  }
  process.stdout.write(`${publicRecords.length} denials, ${fresh.length} new\n`);
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    const clone = getCloneInfo();
    validatePaths(args);
    if (args.command === "scan") {
      scan(args, clone.root, clone.slug);
      return;
    }
    if (args.command === "store") {
      store(args);
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`denial-records: ${message}\n`);
    if (error instanceof CliError && error.exitCode === 2) process.stderr.write(`${usage.join("\n")}\n`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  }
}

main();
