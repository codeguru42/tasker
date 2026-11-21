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
function load(path: string): { template: PromptTemplate | undefined; problems: string[] } {
  const problems: string[] = [];
  if (!promptTemplateParts(path)) problems.push(PATH_PROBLEM);
  const file = readTextFile(path);
  if (file.text === undefined) {
    problems.push(`the file cannot be read: ${file.error}`);
    return { template: undefined, problems };
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
    return { template: undefined, problems };
  }
  const body = lines.slice(close + 1).join("\n");

  let name: string | undefined;
  let description: string | undefined;
  let placeholders: Record<string, string> | undefined;
  let inPlaceholders = false;
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    const entry = /^ {2}([^\s:][^:]*): (.*)$/.exec(line);
    if (inPlaceholders && entry) {
      if (PLACEHOLDER_KEY.test(entry[1])) placeholders![entry[1]] = entry[2];
      else problems.push(`placeholders has a key that is not a placeholder name: ${entry[1]}`);
      continue;
    }
    inPlaceholders = false;
    let match: RegExpExecArray | null;
    if ((match = /^name: (.+)$/.exec(line))) name = match[1];
    else if ((match = /^description: (.+)$/.exec(line))) description = match[1];
    else if (line === "placeholders: {}") placeholders = {};
    else if (line === "placeholders:") {
      placeholders = {};
      inPlaceholders = true;
    } else problems.push(`front matter line ${i + 1} is not a known key: ${line}`);
  }

  const fileName = basename(path, ".md");
  if (name === undefined) problems.push("name is missing");
  else if (name !== fileName) problems.push(`name "${name}" is not the file name "${fileName}"`);
  if (description === undefined) problems.push("description is missing");
  else if (!description.startsWith(DESCRIPTION_START)) {
    problems.push(`description does not start with "${DESCRIPTION_START}"`);
  }
  if (placeholders === undefined) problems.push("placeholders is missing");
  else {
    const used = placeholderNames(body);
    for (const key of Object.keys(placeholders)) {
      if (!used.has(key)) problems.push(`placeholders lists {{${key}}}, but the body does not use it`);
    }
    for (const key of used) {
      if (!(key in placeholders)) problems.push(`the body uses {{${key}}}, but placeholders does not list it`);
    }
  }

  if (problems.length > 0 || name === undefined || description === undefined || placeholders === undefined) {
    return { template: undefined, problems };
  }
  return { template: { name, description, placeholders, body }, problems };
}

// The problems of the template file at path. An empty list means that the file is valid.
export function checkPromptTemplate(path: string): string[] {
  return load(path).problems;
}

// The template at path. It throws one error that lists each problem if the file is not valid.
export function readPromptTemplate(path: string): PromptTemplate {
  const { template, problems } = load(path);
  if (!template || problems.length > 0) {
    throw new Error(`prompt template ${path} has problems:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  }
  return template;
}
