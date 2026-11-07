import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { errnoCode } from "../../errno.js";
import { isInside, realPathWithMissingParents } from "../../real-path.js";

export type PiExtensionSource = "folder" | "settings-extensions" | "settings-packages" | "builtin";

export interface PiExtension {
  key: string;
  source: PiExtensionSource;
}

export const PI_BUILT_IN_EXTENSIONS: readonly { key: string; removable: boolean }[] = [
  { key: "builtin:llama.cpp", removable: true },
  { key: "builtin:codemode", removable: true },
  { key: "builtin:tool-search", removable: true },
];

type ListResult = { extensions: PiExtension[] } | { reason: string };

function codeOf(error: unknown): string {
  return errnoCode(error) ?? "unknown";
}

function settingsReason(file: string, field: "extensions" | "packages"): string {
  return field === "extensions"
    ? `${file}: extensions is not a list of strings`
    : `${file}: packages is not a list of strings and objects with a string source`;
}

function settingsKeys(
  settings: Record<string, unknown>,
  field: "extensions" | "packages",
  file: string,
): {
  keys: string[];
  reason?: string;
} {
  if (!Object.hasOwn(settings, field)) return { keys: [] };
  const value = settings[field];
  if (!Array.isArray(value)) return { keys: [], reason: settingsReason(file, field) };
  const keys: string[] = [];
  for (const entry of value) {
    if (field === "extensions") {
      if (typeof entry !== "string") return { keys: [], reason: settingsReason(file, field) };
      keys.push(entry);
    } else if (typeof entry === "string") {
      keys.push(entry);
    } else if (
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).source === "string"
    ) {
      keys.push((entry as Record<string, string>).source);
    } else {
      return { keys: [], reason: settingsReason(file, field) };
    }
  }
  return { keys };
}

function uniqueExtensions(entries: PiExtension[]): PiExtension[] {
  const seen = new Set<string>();
  return entries.filter(({ key }) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extensionFor(key: string, source: PiExtensionSource): PiExtension {
  return { key, source: key.startsWith("builtin:") ? "builtin" : source };
}

export function listPiExtensions(
  agentDir: string,
  worktree: string,
  builtIns: readonly { key: string; removable: boolean }[] = PI_BUILT_IN_EXTENSIONS,
): ListResult {
  const agentPath = resolve(agentDir);
  const worktreePath = resolve(worktree);
  let realAgent: string;
  try {
    realAgent = realPathWithMissingParents(agentPath);
  } catch (error) {
    return { reason: `tasker cannot find the real path of ${agentPath}: ${codeOf(error)}` };
  }
  let realWorktree: string;
  try {
    realWorktree = realPathWithMissingParents(worktreePath);
  } catch (error) {
    return { reason: `tasker cannot find the real path of ${worktreePath}: ${codeOf(error)}` };
  }
  if (isInside(realAgent, realWorktree)) {
    return { reason: `the agent folder of pi is in the worktree: ${agentPath}` };
  }

  const settingsFile = join(agentPath, "settings.json");
  const folder = join(agentPath, "extensions");
  const settingsReasons: string[] = [];
  const folderReasons: string[] = [];
  let extensionKeys: string[] = [];
  let packageKeys: string[] = [];
  try {
    const content = readFileSync(settingsFile, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      settingsReasons.push(`${settingsFile} is not valid JSON`);
      parsed = undefined;
    }
    if (parsed !== undefined) {
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        settingsReasons.push(`${settingsFile} is not a JSON object`);
      } else {
        const settings = parsed as Record<string, unknown>;
        const extensions = settingsKeys(settings, "extensions", settingsFile);
        const packages = settingsKeys(settings, "packages", settingsFile);
        if (extensions.reason) settingsReasons.push(extensions.reason);
        else extensionKeys = extensions.keys;
        if (packages.reason) settingsReasons.push(packages.reason);
        else packageKeys = packages.keys;
      }
    }
  } catch (error) {
    const code = errnoCode(error);
    if (code !== "ENOENT") settingsReasons.push(`tasker cannot read ${settingsFile}: ${codeOf(error)}`);
  }

  const folderEntries: PiExtension[] = [];
  try {
    const names = readdirSync(folder).sort();
    for (const name of names) folderEntries.push({ key: join(folder, name), source: "folder" });
  } catch (error) {
    const code = errnoCode(error);
    if (code !== "ENOENT") folderReasons.push(`tasker cannot list ${folder}: ${codeOf(error)}`);
  }

  const reasons = [...settingsReasons, ...folderReasons];
  if (reasons.length > 0) return { reason: reasons.join("\n") };

  const removedBuiltIns = new Set(
    extensionKeys
      .filter((key) => key.startsWith("-builtin:"))
      .map((key) => key.slice(1))
      .filter((key) => builtIns.some((entry) => entry.key === key && entry.removable)),
  );
  const entries: PiExtension[] = [...folderEntries];
  for (const item of extensionKeys) {
    if (item.startsWith("-") || item.startsWith("!")) continue;
    const key = item.startsWith("+") ? item.slice(1) : item;
    entries.push(extensionFor(key, "settings-extensions"));
  }
  for (const key of packageKeys) entries.push(extensionFor(key, "settings-packages"));
  for (const builtin of builtIns) {
    if (!removedBuiltIns.has(builtin.key)) entries.push({ key: builtin.key, source: "builtin" });
  }
  return { extensions: uniqueExtensions(entries) };
}

const SOURCE_LABELS: Readonly<Record<PiExtensionSource, string>> = {
  folder: "the extensions folder of the agent folder",
  "settings-extensions": "extensions of settings.json",
  "settings-packages": "packages of settings.json",
  builtin: "built-in",
};

export function piExtensionRefusal(agentDir: string, worktree: string, trusted: readonly string[]): string | undefined {
  const listed = listPiExtensions(agentDir, worktree);
  if ("reason" in listed) return listed.reason;
  const trustedKeys = new Set(trusted);
  const untrusted = listed.extensions.filter(({ key }) => !trustedKeys.has(key));
  if (untrusted.length === 0) return undefined;
  const details = untrusted.map(({ key, source }) => `${maskExtensionKey(key)} (${SOURCE_LABELS[source]})`).join(", ");
  return `pi can load extensions that assistant.trustedExtensions does not list: ${details}. Add each key to assistant.trustedExtensions of the repo.`;
}

export function maskExtensionKey(key: string): string {
  const scheme = key.indexOf("://");
  const slash = scheme < 0 ? -1 : key.indexOf("/", scheme + 3);
  const authorityEnd = slash < 0 ? key.length : slash;
  const at = key.lastIndexOf("@", authorityEnd - 1);
  if (scheme < 0 || at < scheme + 3) return key;
  return `${key.slice(0, scheme + 3)}***@${key.slice(at + 1)}`;
}
