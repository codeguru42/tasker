import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../../helpers/temp.js";
import type { PiExtension } from "../../../src/assistant/pi/extensions.js";
import {
  listPiExtensions,
  piExtensionRefusal,
  maskExtensionKey,
  PI_BUILT_IN_EXTENSIONS,
} from "../../../src/assistant/pi/extensions.js";

function writeSettings(agentDir: string, value: unknown) {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(value));
}

function listed(agentDir: string, worktree: string) {
  const result = listPiExtensions(agentDir, worktree);
  if (!("extensions" in result)) throw new Error((result as { reason: string }).reason);
  return (result as { extensions: PiExtension[] }).extensions;
}

describe("pi extension keys", () => {
  it("lists sorted folders, settings extensions, packages and built-ins in order", () => {
    const root = useTempDir("tasker-pi-extensions-");
    const agentDir = join(root, "agent");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(join(agentDir, "extensions", "z.js"), "");
    mkdirSync(join(agentDir, "extensions", "a"));
    writeSettings(agentDir, {
      extensions: ["+one", "-gone", "!ignored", "builtin:codemode"],
      packages: ["pkg", { source: "https://user:secret@example.com/pkg" }],
    });

    expect(listed(agentDir, join(root, "repo"))).toEqual([
      { key: join(agentDir, "extensions", "a"), source: "folder" },
      { key: join(agentDir, "extensions", "z.js"), source: "folder" },
      { key: "one", source: "settings-extensions" },
      { key: "builtin:codemode", source: "builtin" },
      { key: "pkg", source: "settings-packages" },
      { key: "https://user:secret@example.com/pkg", source: "settings-packages" },
      { key: "builtin:llama.cpp", source: "builtin" },
      { key: "builtin:tool-search", source: "builtin" },
    ]);
  });

  it("deduplicates exact keys, preserves positive built-ins and removes only removable defaults", () => {
    const root = useTempDir("tasker-pi-builtins-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    writeSettings(agentDir, {
      extensions: ["-builtin:codemode", "+builtin:codemode", "builtin:mcp", "-pkg", "!ignored", "+pkg"],
      packages: ["pkg"],
    });
    expect(listed(agentDir, join(root, "repo")).map(({ key }) => key)).toEqual([
      "builtin:codemode",
      "builtin:mcp",
      "pkg",
      "builtin:llama.cpp",
      "builtin:tool-search",
    ]);
    expect(PI_BUILT_IN_EXTENSIONS).toEqual([
      { key: "builtin:llama.cpp", removable: true },
      { key: "builtin:codemode", removable: true },
      { key: "builtin:tool-search", removable: true },
    ]);
  });

  it("keeps a non-removable built-in when settings asks to remove it", () => {
    const root = useTempDir("tasker-pi-fixed-builtins-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    writeSettings(agentDir, { extensions: ["-builtin:fixed"] });
    expect(listPiExtensions(agentDir, join(root, "repo"), [{ key: "builtin:fixed", removable: false }])).toEqual({
      extensions: [{ key: "builtin:fixed", source: "builtin" }],
    });
  });

  it("keeps package source text and accepts an empty object source", () => {
    const root = useTempDir("tasker-pi-packages-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    writeSettings(agentDir, { packages: ["-literal", { source: "" }] });
    expect(listed(agentDir, join(root, "repo")).slice(0, 2)).toEqual([
      { key: "-literal", source: "settings-packages" },
      { key: "", source: "settings-packages" },
    ]);
  });

  it("uses exact key matching for refusal and masks URL user data", () => {
    const root = useTempDir("tasker-pi-refusal-");
    const agentDir = join(root, "agent");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(join(agentDir, "extensions", "local"), "");
    writeSettings(agentDir, { packages: ["https://alice:secret@example.com/path"] });
    const extensions = listed(agentDir, join(root, "repo"));
    expect(
      piExtensionRefusal(agentDir, join(root, "repo"), ["local", "https://alice:secret@example.com/path"]),
    ).toBeUndefined();
    expect(piExtensionRefusal(agentDir, join(root, "repo"), ["local-prefix"])).toContain(
      "pi can load extensions that assistant.trustedExtensions does not list:",
    );
    expect(extensions).toHaveLength(5);
    const refusal = piExtensionRefusal(agentDir, join(root, "repo"), []);
    expect(refusal).toBe(
      `pi can load extensions that assistant.trustedExtensions does not list: ${join(agentDir, "extensions", "local")} (the extensions folder of the agent folder), https://***@example.com/path (packages of settings.json), builtin:llama.cpp (built-in), builtin:codemode (built-in), builtin:tool-search (built-in). Add each key to assistant.trustedExtensions of the repo.`,
    );
    expect(refusal).not.toContain("secret");
    expect(maskExtensionKey("https://alice:secret@example.com/path")).toBe("https://***@example.com/path");
    expect(maskExtensionKey("ssh://alice@host")).toBe("ssh://***@host");
  });

  it("returns exact reasons for real path failures and agent containment", () => {
    const root = useTempDir("tasker-pi-real-path-");
    const repo = join(root, "repo");
    const agentDir = join(root, "agent");
    mkdirSync(repo);
    mkdirSync(agentDir);
    expect(listPiExtensions(join(root, "missing"), repo)).toEqual({
      reason: `tasker cannot find the real path of ${join(root, "missing")}: ENOENT`,
    });
    expect(listPiExtensions(agentDir, join(root, "missing-worktree"))).toEqual({
      reason: `tasker cannot find the real path of ${join(root, "missing-worktree")}: ENOENT`,
    });
    const link = join(root, "agent-link");
    symlinkSync(repo, link);
    expect(listPiExtensions(link, repo)).toEqual({ reason: `the agent folder of pi is in the worktree: ${link}` });
  });

  it("reports every settings and folder reason in order without exposing settings content", () => {
    const root = useTempDir("tasker-pi-invalid-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    const file = join(agentDir, "settings.json");
    writeFileSync(file, '{"extensions":null,"packages":[4],"token":"secret"}');
    const result = listPiExtensions(agentDir, join(root, "repo"));
    expect(result).toEqual({
      reason: [
        `${file}: extensions is not a list of strings`,
        `${file}: packages is not a list of strings and objects with a string source`,
        `tasker cannot list ${join(agentDir, "extensions")}: ENOENT`,
      ].join("\n"),
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reports a settings read error and an extensions path that is not a folder", () => {
    const root = useTempDir("tasker-pi-read-errors-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    mkdirSync(join(agentDir, "settings.json"));
    writeFileSync(join(agentDir, "extensions"), "not a folder");
    expect(listPiExtensions(agentDir, join(root, "repo"))).toEqual({
      reason: [
        `tasker cannot read ${join(agentDir, "settings.json")}: EISDIR`,
        `tasker cannot list ${join(agentDir, "extensions")}: ENOTDIR`,
      ].join("\n"),
    });
  });

  it.each([
    ["invalid JSON", "{secret", (file: string) => `${file} is not valid JSON`],
    ["non-object JSON", "null", (file: string) => `${file} is not a JSON object`],
  ])("reports %s with exact reason", (_label, content, expected) => {
    const root = useTempDir("tasker-pi-settings-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    const file = join(agentDir, "settings.json");
    writeFileSync(file, content);
    expect(listPiExtensions(agentDir, join(root, "repo"))).toEqual({
      reason: `${expected(file)}\ntasker cannot list ${join(agentDir, "extensions")}: ENOENT`,
    });
  });
});
