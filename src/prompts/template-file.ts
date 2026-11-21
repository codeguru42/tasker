import { basename, sep } from "node:path";
import { readTextFile } from "../read-text-file.js";
import { placeholderNames } from "./template.js";

export interface PromptTemplate {
  name: string;
  description: string;
  placeholders: Record<string, string>;
  body: string;
}

const FOLDER = "prompt-templates";
const PART = /^[a-z0-9-]+$/;
const PLACEHOLDER_KEY = /^[A-Z][A-Z0-9_]*$/;
const DESCRIPTION_START = "Load this template when";
export const PATH_PROBLEM = `the path is not ${FOLDER}/<family>/<name>.md, with lowercase letters, digits and - in each part`;

// The family and the name of a template path, or undefined if the path is not prompt-templates/<family>/<name>.md.
export function promptTemplateParts(path: string): { family: string; name: string } | undefined {
  const segments = path.split(sep);
  const folder = segments.lastIndexOf(FOLDER);
  if (folder < 0 || segments.length - folder !== 3) return undefined;
  const family = segments[folder + 1];
  const file = segments[folder + 2];
  if (!file.endsWith(".md")) return undefined;
  const name = file.slice(0, -".md".length);
  return PART.test(family) && PART.test(name) ? { family, name } : undefined;
}

// Reads the file at path and finds its problems. The template is set only when there is no problem.
function load(path: string): { template: PromptTemplate } | { problems: string[] } {
  const problems: string[] = [];
  if (!promptTemplateParts(path)) problems.push(PATH_PROBLEM);
  const file = readTextFile(path);
  if (file.text === undefined) {
    problems.push(`the file cannot be read: ${file.error}`);
    return { problems };
  }
  let text = file.text;
  if (text.includes("\r")) {
    problems.push("the file has CRLF line ends");
    text = text.replaceAll("\r", "");
  }
  const lines = text.split("\n");
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (close < 0) {
    problems.push("the file has no front matter between two --- lines");
    return { problems };
  }
  const body = lines.slice(close + 1).join("\n");

  const seen = new Set<string>();
  let name = "";
  let description = "";
  const placeholders: Record<string, string> = {};
  let entries: Record<string, string> = placeholders;
  let inPlaceholders = false;
  // True for the first line of a key. A later line of the same key is a problem, and the first value stays.
  const first = (key: string, i: number): boolean => {
    if (seen.has(key)) {
      problems.push(`front matter line ${i + 1} repeats the key ${key}`);
      return false;
    }
    seen.add(key);
    return true;
  };
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    const entry = /^ {2}([^\s:][^:]*): (.*)$/.exec(line);
    if (inPlaceholders && entry) {
      if (PLACEHOLDER_KEY.test(entry[1])) entries[entry[1]] = entry[2];
      else problems.push(`placeholders has a key that is not a placeholder name: ${entry[1]}`);
      continue;
    }
    inPlaceholders = false;
    let match: RegExpExecArray | null;
    if ((match = /^name: (.+)$/.exec(line))) {
      if (first("name", i)) name = match[1];
    } else if ((match = /^description: (.+)$/.exec(line))) {
      if (first("description", i)) description = match[1];
    } else if (line === "placeholders: {}") first("placeholders", i);
    else if (line === "placeholders:") {
      entries = first("placeholders", i) ? placeholders : {};
      inPlaceholders = true;
    } else problems.push(`front matter line ${i + 1} is not a known key: ${line}`);
  }

  const fileName = basename(path, ".md");
  if (!seen.has("name")) problems.push("name is missing");
  else if (name !== fileName) problems.push(`name "${name}" is not the file name "${fileName}"`);
  if (!seen.has("description")) problems.push("description is missing");
  else if (!description.startsWith(DESCRIPTION_START)) {
    problems.push(`description does not start with "${DESCRIPTION_START}"`);
  }
  if (!seen.has("placeholders")) problems.push("placeholders is missing");
  else {
    const used = placeholderNames(body);
    for (const key of Object.keys(placeholders)) {
      if (!used.has(key)) problems.push(`placeholders lists {{${key}}}, but the body does not use it`);
    }
    for (const key of used) {
      if (!(key in placeholders)) problems.push(`the body uses {{${key}}}, but placeholders does not list it`);
    }
  }

  if (problems.length > 0) return { problems };
  return { template: { name, description, placeholders, body } };
}

// The problems of the template file at path. An empty list means that the file is valid.
export function checkPromptTemplate(path: string): string[] {
  const result = load(path);
  return "problems" in result ? result.problems : [];
}

// The template at path. It throws one error that lists each problem if the file is not valid.
export function readPromptTemplate(path: string): PromptTemplate {
  const result = load(path);
  if ("problems" in result) {
    throw new Error(
      `prompt template ${path} has problems:\n${result.problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
  }
  return result.template;
}
