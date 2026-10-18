import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { onTestFinished, vi } from "vitest";

// A new empty folder under the system temp folder. The caller removes it.
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// A new temp folder that is removed after the test. Call it inside a test.
export function useTempDir(prefix: string): string {
  const dir = makeTempDir(prefix);
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A new temp folder (see useTempDir()) with one file name in it that holds content. It gives the path of the file.
// Call it inside a test.
export function useTempFile(prefix: string, name: string, content: string): string {
  const path = join(useTempDir(prefix), name);
  writeFileSync(path, content);
  return path;
}

// A new temp folder (see useTempDir()) as HOME, with XDG_CONFIG_HOME at <HOME>/config. Call it inside a test.
export function useTempHome(): { HOME: string; XDG_CONFIG_HOME: string } {
  const home = useTempDir("tasker-home-");
  return { HOME: home, XDG_CONFIG_HOME: join(home, "config") };
}

// Sets each name of env in process.env for this test. A value of undefined removes the name.
// After the test, it restores process.env. Call it inside a test.
export function useProcessEnv(env: NodeJS.ProcessEnv): void {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}

// Sets the mtime of file to ageMs milliseconds in the past.
export function ageFile(path: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
}

export interface TreeEntry {
  // The path relative to the folder.
  path: string;
  type: "file" | "directory" | "link" | "other";
  size: number;
  mtimeMs: number;
}

// A sorted list of every entry under folder. It uses lstat and follows no link.
export function treeSnapshot(folder: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stat = lstatSync(path);
      const type = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "link" : "other";
      entries.push({ path: relative(folder, path), type, size: stat.size, mtimeMs: stat.mtimeMs });
      if (type === "directory") {
        walk(path);
      }
    }
  };
  walk(folder);
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// Writes the text to the file at the path and makes its missing parent folders.
export function writeFileWithParents(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
