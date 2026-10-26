import { isObject } from "../../object.js";

// The input of adfToText() is not an ADF document.
export class AdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdfError";
  }
}

const INLINE_TYPES = new Set([
  "text",
  "hardBreak",
  "inlineCard",
  "mention",
  "media",
  "emoji",
  "status",
  "date",
  "inlineExtension",
]);

const INLINE_PARENTS = new Set(["paragraph", "heading"]);

type Node = Record<string, unknown>;

function typeOf(node: Node): string | undefined {
  return typeof node.type === "string" ? node.type : undefined;
}

// The value of an attribute, or undefined when it is not a non-empty string.
function attr(node: Node, name: string): string | undefined {
  const { attrs } = node;
  if (!isObject(attrs)) {
    return undefined;
  }
  const value = attrs[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function childrenOf(node: Node): unknown[] {
  return Array.isArray(node.content) ? node.content : [];
}

function isInline(child: unknown, parent: string | undefined): boolean {
  if (parent !== undefined && INLINE_PARENTS.has(parent)) {
    return true;
  }
  if (!isObject(child)) {
    return false;
  }
  const type = typeOf(child);
  return type !== undefined && INLINE_TYPES.has(type);
}

// Joins each run of inline children with no separator. Each block child is a part of its own.
// Empty parts are dropped, so a block that gives "" adds no line.
function joinChildren(node: Node, type: string | undefined): string {
  const parts: string[] = [];
  let inlineRun: string | undefined;
  for (const child of childrenOf(node)) {
    const text = render(child);
    if (isInline(child, type)) {
      inlineRun = (inlineRun ?? "") + text;
      continue;
    }
    if (inlineRun !== undefined) {
      parts.push(inlineRun);
      inlineRun = undefined;
    }
    parts.push(text);
  }
  if (inlineRun !== undefined) {
    parts.push(inlineRun);
  }
  return parts.filter((part) => part !== "").join(type === "listItem" ? "\n" : "\n\n");
}

function renderList(node: Node, ordered: boolean): string {
  const order = isObject(node.attrs) ? node.attrs.order : undefined;
  let number = typeof order === "number" ? order : 1;
  const lines = childrenOf(node).map((child) => {
    const marker = ordered ? `${number}.` : "-";
    number += 1;
    const text = render(child);
    if (text === "") {
      return marker;
    }
    const indent = " ".repeat(marker.length + 1);
    return text
      .split("\n")
      .map((line, index) => (index === 0 ? `${marker} ${line}` : `${indent}${line}`))
      .join("\n");
  });
  return lines.join("\n");
}

function render(value: unknown): string {
  if (!isObject(value)) {
    return "";
  }
  const type = typeOf(value);
  switch (type) {
    case "text":
      return typeof value.text === "string" ? value.text : "";
    case "hardBreak":
      return "\n";
    case "bulletList":
      return renderList(value, false);
    case "orderedList":
      return renderList(value, true);
    case "codeBlock":
      return childrenOf(value)
        .map((child) => (isObject(child) && child.type === "text" && typeof child.text === "string" ? child.text : ""))
        .join("");
    case "inlineCard":
    case "blockCard":
    case "embedCard":
      return attr(value, "url") ?? "";
    case "mention":
      return attr(value, "text") ?? "";
    case "media": {
      const name = attr(value, "alt") ?? attr(value, "id");
      return name === undefined ? "[attachment]" : `[attachment: ${name}]`;
    }
    case "rule":
      return "";
    default:
      return joinChildren(value, type);
  }
}

function checkDocument(value: unknown): Node {
  if (typeof value !== "object" || value === null) {
    throw new AdfError(`the ADF document is ${typeof value}`);
  }
  if (Array.isArray(value)) {
    throw new AdfError("the ADF document is an array");
  }
  const node = value as Node;
  if (typeof node.type !== "string") {
    throw new AdfError("the ADF document is an object with no type");
  }
  if (node.type !== "doc") {
    throw new AdfError(`the ADF document is a node of the type "${node.type}"`);
  }
  if (!Array.isArray(node.content)) {
    throw new AdfError("the ADF document is a doc node with no content array");
  }
  return node;
}

// Turns an ADF document into plain text. null and undefined give "".
// Any other input that is not a doc node with a content array throws an AdfError.
export function adfToText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  const lines = render(checkDocument(value))
    .split("\n")
    .map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
}
