import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isInside } from "../../src/real-path.js";

export const sourceDir = fileURLToPath(new URL("../../src/", import.meta.url));

const childProcessName = String.raw`["'\`](?:node:)?child_process["'\`]`;
const loadsChildProcessPattern = new RegExp(
  [
    String.raw`\bfrom\s*${childProcessName}`, // import ... from, export ... from
    String.raw`\bimport\s*${childProcessName}`, // import "child_process"
    String.raw`\bimport\s*\(\s*${childProcessName}`, // import("child_process")
    String.raw`\brequire\s*\(\s*${childProcessName}`, // require("child_process")
  ].join("|"),
);

// True when text loads the child process module in any of these forms.
export function loadsChildProcess(text: string): boolean {
  return loadsChildProcessPattern.test(text);
}

export interface SourceFile {
  file: string;
  text: string;
}

// Each .ts file under src/ (a path with "/") and its text.
export function sourceFiles(): SourceFile[] {
  return readdirSync(sourceDir, { recursive: true, encoding: "utf8" })
    .map((file) => file.split("\\").join("/"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ file, text: readFileSync(join(sourceDir, file), "utf8") }));
}

const moduleSpecifierPattern = /\b(?:from|import|require)\s*\(?\s*(["'`])([^"'`]+)\1/g;

// True when text (the text of file, a path under src/ with "/") loads or re-exports target.
// target is a path under sourceDir: a folder, or a .ts file. A relative specifier counts when
// it resolves to target or to a path inside target. A ".js" ending counts as ".ts" (NodeNext).
// It cannot find a module name that the code builds at run time.
export function importsPath(file: string, text: string, target: string): boolean {
  const fileDir = join(sourceDir, dirname(file));
  return [...text.matchAll(moduleSpecifierPattern)].some((match) => {
    const specifier = match[2];
    if (!specifier.startsWith(".")) return false;
    const resolved = resolve(fileDir, specifier);
    return isInside(resolved, target) || resolved.replace(/\.js$/, ".ts") === target;
  });
}

export const runChildPath = join(sourceDir, "process", "run-child.ts");

// True when text (the text of file) starts command: it loads child_process or imports
// src/process/run-child.ts, and it has the string literal command or "command ...".
export function startsCommand(file: string, text: string, command: string): boolean {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const commandLiteral = new RegExp(`(["'\`])${escaped}(?: [^"'\`]*)?\\1`);
  return (loadsChildProcess(text) || importsPath(file, text, runChildPath)) && commandLiteral.test(text);
}

// The files under src/ (paths with "/") that start command.
// The scan finds a literal command, alone or followed by a space and arguments, and a literal module name.
// It cannot find a module name or a command name that is built at run time.
export function filesThatStart(command: string): string[] {
  return sourceFiles()
    .filter(({ file, text }) => startsCommand(file, text, command))
    .map(({ file }) => file);
}

// The folder under src/ of target, a path written with "/" (for example "vcs/git").
function sourcePath(target: string): string {
  return join(sourceDir, ...target.split("/"));
}

// The files under src/ (paths with "/") that load or re-export a module in target, a folder
// under src/ written with "/" (for example "vcs/git"). It cannot find a module name that the
// code builds at run time.
export function filesThatImport(target: string): string[] {
  return sourceFiles()
    .filter(({ file, text }) => importsPath(file, text, sourcePath(target)))
    .map(({ file }) => file);
}

// True when file (a path under src/ with "/") does not start with owner (for example "vcs/")
// and loads or re-exports a module in target (for example "vcs/git").
export function breaksBoundary(file: string, text: string, owner: string, target: string): boolean {
  return !file.startsWith(owner) && importsPath(file, text, sourcePath(target));
}

// The files under src/ that break the boundary of breaksBoundary().
export function filesThatBreakBoundary(owner: string, target: string): string[] {
  return sourceFiles()
    .filter(({ file, text }) => breaksBoundary(file, text, owner, target))
    .map(({ file }) => file);
}
