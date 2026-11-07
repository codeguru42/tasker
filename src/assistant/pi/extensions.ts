import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { errnoCode } from "../../errno.js";
import { isInside, realPathWithMissingParents } from "../../real-path.js";

export type PiExtensionSource = "agent folder" | "extensions" | "packages" | "builtin";

export interface PiExtension {
  key: string;
  source: PiExtensionSource;
  removable: boolean;
}

export const PI_BUILT_IN_EXTENSIONS: readonly PiExtension[] = [
  { key: "builtin:llama.cpp", source: "builtin", removable: true },
  { key: "builtin:codemode", source: "builtin", removable: true },
  { key: "builtin:tool-search", source: "builtin", removable: true },
];

type ListResult = PiExtension[] | { reason: string };

function failure(label: string, detail: string): string {
  return `pi extension precheck cannot read ${label}: ${detail}`;
}

function unique(entries: PiExtension[]): PiExtension[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
}

function settingsEntries(value: unknown, field: "extensions" | "packages"): string[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return `settings.json field ${field} must be an array`;
  const output: string[] = [];
  for (const item of value) {
    let entry: unknown = item;
    if (field === "packages" && typeof item === "object" && item !== null && !Array.isArray(item)) {
      entry = (item as Record<string, unknown>).source;
    }
    if (typeof entry !== "string" || entry.length === 0) {
      return `settings.json field ${field} must contain strings${field === "packages" ? " or objects with a string source" : ""}`;
    }
    output.push(entry);
  }
  return output;
}

export function listPiExtensions(agentDir: string, worktree: string): ListResult {
  const agentPath = resolve(agentDir);
  const worktreePath = resolve(worktree);
  let realAgent: string;
  let realWorktree: string;
  try {
    realAgent = realPathWithMissingParents(agentPath);
  } catch {
    return { reason: "pi extension precheck cannot find the real path of the agent folder" };
  }
  try {
    realWorktree = realPathWithMissingParents(worktreePath);
  } catch {
    return { reason: "pi extension precheck cannot find the real path of the worktree" };
  }
  if (isInside(realAgent, realWorktree)) {
    return { reason: "pi extension precheck refuses an agent folder inside the worktree" };
  }

  const failures: string[] = [];
  const entries: PiExtension[] = [];
  try {
    const files = readdirSync(join(agentPath, "extensions"), { withFileTypes: true });
    for (const item of files.map((entry) => entry.name).sort()) {
      entries.push({ key: join(agentPath, "extensions", item), source: "agent folder", removable: false });
    }
  } catch (error) {
    const code = errnoCode(error);
    if (code !== "ENOENT" && code !== "ENOTDIR") failures.push(failure("extensions folder", "it cannot be listed"));
  }

  let extensions: string[] = [];
  let packages: string[] = [];
  try {
    const content = readFileSync(join(agentPath, "settings.json"), "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      failures.push(failure("settings.json", "it is invalid JSON"));
      parsed = {};
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      failures.push(failure("settings.json", "it must contain an object"));
    } else {
      const settings = parsed as Record<string, unknown>;
      const ext = settingsEntries(settings.extensions, "extensions");
      const pkgs = settingsEntries(settings.packages, "packages");
      if (typeof ext === "string") failures.push(failure("settings.json", ext));
      else extensions = ext;
      if (typeof pkgs === "string") failures.push(failure("settings.json", pkgs));
      else packages = pkgs;
    }
  } catch (error) {
    const code = errnoCode(error);
    if (code !== "ENOENT") failures.push(failure("settings.json", "it cannot be read"));
  }
  if (failures.length > 0) return { reason: failures.join("; ") };

  const removed = new Set(extensions.filter((item) => item.startsWith("-builtin:")).map((item) => item.slice(1)));
  for (const item of extensions) {
    if (item.startsWith("-") || item.startsWith("!")) continue;
    const key = item.startsWith("+") ? item.slice(1) : item;
    if (key.length > 0)
      entries.push({ key, source: key.startsWith("builtin:") ? "builtin" : "extensions", removable: false });
  }
  for (const item of packages) {
    if (item.startsWith("-") || item.startsWith("!")) continue;
    const key = item.startsWith("+") ? item.slice(1) : item;
    if (key.length > 0) entries.push({ key, source: "packages", removable: false });
  }
  for (const builtin of PI_BUILT_IN_EXTENSIONS) {
    if (!removed.has(builtin.key)) entries.push(builtin);
  }
  return unique(entries);
}

export function piExtensionRefusal(extensions: PiExtension[], trusted: string[]): string | undefined {
  const trustedKeys = new Set(trusted);
  const untrusted = extensions.filter((extension) => !trustedKeys.has(extension.key));
  if (untrusted.length === 0) return undefined;
  return `pi can load untrusted extensions: ${untrusted.map((extension) => `${extension.source} (${maskExtensionKey(extension.key)})`).join(", ")}`;
}

export function maskExtensionKey(key: string): string {
  const scheme = key.indexOf("://");
  const slash = scheme < 0 ? -1 : key.indexOf("/", scheme + 3);
  const authorityEnd = slash < 0 ? key.length : slash;
  const at = key.lastIndexOf("@", authorityEnd - 1);
  if (scheme < 0 || at < scheme + 3) return key;
  return `${key.slice(0, scheme + 3)}***@${key.slice(at + 1)}`;
}
