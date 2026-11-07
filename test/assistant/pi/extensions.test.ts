import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../../helpers/temp.js";
import {
  listPiExtensions,
  piExtensionRefusal,
  maskExtensionKey,
  PI_BUILT_IN_EXTENSIONS,
} from "../../../src/assistant/pi/extensions.js";

function writeSettings(agentDir: string, value: unknown) {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(value));
}

function callListPiExtensions(
  agentDir: string,
  worktree: string,
  builtIns?: readonly { key: string; removable: boolean }[],
) {
  return listPiExtensions(agentDir, worktree, builtIns);
}

function callPiExtensionRefusal(agentDir: string, worktree: string, trusted: readonly string[]) {
  return piExtensionRefusal(agentDir, worktree, trusted);
}

function callMaskExtensionKey(key: string) {
  return maskExtensionKey(key);
}

function listed(agentDir: string, worktree: string) {
  const result = callListPiExtensions(agentDir, worktree);
  if ("reason" in result) throw new Error(result.reason);
  return result.extensions;
}

describe("pi extension keys", () => {
  it("lists sorted folders, settings extensions, packages and built-ins in order", () => {
    const root = useTempDir("tasker-pi-extensions-");
    const agentDir = join(root, "agent");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(join(agentDir, "extensions", "z.js"), "");
    mkdirSync(join(agentDir, "extensions", "a"));
    const supplementary = String.fromCodePoint(0x10000);
    const privateUse = String.fromCodePoint(0xe000);
    writeFileSync(join(agentDir, "extensions", supplementary), "");
    mkdirSync(join(agentDir, "extensions", privateUse));
    writeSettings(agentDir, {
      extensions: ["+one", "-gone", "!ignored", "builtin:codemode"],
      packages: ["pkg", { source: "https://user:secret@example.com/pkg" }],
    });

    expect(listed(agentDir, join(root, "repo"))).toEqual([
      { key: join(agentDir, "extensions", "a"), source: "folder" },
      { key: join(agentDir, "extensions", "z.js"), source: "folder" },
      { key: join(agentDir, "extensions", supplementary), source: "folder" },
      { key: join(agentDir, "extensions", privateUse), source: "folder" },
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
      extensions: [
        "-builtin:codemode",
        "builtin:codemode",
        "+builtin:codemode",
        "builtin:mcp",
        "-pkg",
        "!ignored",
        "+pkg",
      ],
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
    expect(callListPiExtensions(agentDir, join(root, "repo"), [{ key: "builtin:fixed", removable: false }])).toEqual({
      extensions: [{ key: "builtin:fixed", source: "builtin" }],
    });
  });

  it("keeps the other defaults when settings removes codemode", () => {
    const root = useTempDir("tasker-pi-remove-codemode-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    writeSettings(agentDir, { extensions: ["-builtin:codemode"] });
    expect(listed(agentDir, join(root, "repo"))).toEqual([
      { key: "builtin:llama.cpp", source: "builtin" },
      { key: "builtin:tool-search", source: "builtin" },
    ]);
  });

  it.each(["+builtin:codemode", "builtin:codemode"])(
    "keeps positive %s after a matching negative entry",
    (positive) => {
      const root = useTempDir("tasker-pi-positive-builtin-");
      const agentDir = join(root, "agent");
      mkdirSync(agentDir);
      writeSettings(agentDir, { extensions: ["-builtin:codemode", positive] });
      expect(listed(agentDir, join(root, "repo"))).toEqual([
        { key: "builtin:codemode", source: "builtin" },
        { key: "builtin:llama.cpp", source: "builtin" },
        { key: "builtin:tool-search", source: "builtin" },
      ]);
    },
  );

  it("ignores ordinary negative and bang entries", () => {
    const root = useTempDir("tasker-pi-negative-entries-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    writeSettings(agentDir, { extensions: ["-package", "!ignored"] });
    expect(listed(agentDir, join(root, "repo"))).toEqual([
      { key: "builtin:llama.cpp", source: "builtin" },
      { key: "builtin:codemode", source: "builtin" },
      { key: "builtin:tool-search", source: "builtin" },
    ]);
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
      callPiExtensionRefusal(agentDir, join(root, "repo"), [
        join(agentDir, "extensions", "local"),
        "https://alice:secret@example.com/path",
        "builtin:llama.cpp",
        "builtin:codemode",
        "builtin:tool-search",
      ]),
    ).toBeUndefined();
    expect(callPiExtensionRefusal(agentDir, join(root, "repo"), ["local-prefix"])).toBe(
      `pi can load extensions that assistant.trustedExtensions does not list: ${join(agentDir, "extensions", "local")} (the extensions folder of the agent folder), https://***@example.com/path (packages of settings.json), builtin:llama.cpp (built-in), builtin:codemode (built-in), builtin:tool-search (built-in). Add each key to assistant.trustedExtensions of the repo.`,
    );
    expect(
      callPiExtensionRefusal(agentDir, join(root, "repo"), [
        join(agentDir, "extensions", "local"),
        "https://Alice:secret@example.com/path",
        "builtin:llama.cpp",
        "builtin:codemode",
        "builtin:tool-search",
      ]),
    ).toContain("https://***@example.com/path");
    expect(callPiExtensionRefusal(agentDir, join(root, "repo"), ["BUILTIN:CODEMODE"])).toContain(
      "builtin:codemode (built-in)",
    );
    expect(callPiExtensionRefusal(agentDir, join(root, "repo"), ["https://alice:secret@example.com/Path"])).toBe(
      `pi can load extensions that assistant.trustedExtensions does not list: ${join(agentDir, "extensions", "local")} (the extensions folder of the agent folder), https://***@example.com/path (packages of settings.json), builtin:llama.cpp (built-in), builtin:codemode (built-in), builtin:tool-search (built-in). Add each key to assistant.trustedExtensions of the repo.`,
    );
    expect(
      callPiExtensionRefusal(agentDir, join(root, "repo"), [
        join(agentDir, "extensions", "local"),
        "https://alice:secret@example.com/path",
        "builtin:llama.cpp",
        "builtin:tool-search",
      ]),
    ).toBe(
      "pi can load extensions that assistant.trustedExtensions does not list: builtin:codemode (built-in). Add each key to assistant.trustedExtensions of the repo.",
    );
    expect(extensions).toHaveLength(5);
    const refusal = callPiExtensionRefusal(agentDir, join(root, "repo"), []);
    expect(refusal).toBe(
      `pi can load extensions that assistant.trustedExtensions does not list: ${join(agentDir, "extensions", "local")} (the extensions folder of the agent folder), https://***@example.com/path (packages of settings.json), builtin:llama.cpp (built-in), builtin:codemode (built-in), builtin:tool-search (built-in). Add each key to assistant.trustedExtensions of the repo.`,
    );
    expect(refusal).not.toContain("secret");
    expect(callMaskExtensionKey("https://alice:secret@example.com/path")).toBe("https://***@example.com/path");
    expect(callMaskExtensionKey("ssh://alice@host")).toBe("ssh://***@host");
    expect(callMaskExtensionKey("https://a@b@host/path")).toBe("https://***@host/path");
    expect(callMaskExtensionKey("https://host/a@b/path")).toBe("https://host/a@b/path");
    expect(callMaskExtensionKey("https://a@host")).toBe("https://***@host");
    expect(callMaskExtensionKey("user@host/path")).toBe("user@host/path");
  });

  it("returns only defaults when settings.json is missing", () => {
    const root = useTempDir("tasker-pi-missing-settings-");
    const agentDir = join(root, "agent");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    const expected = {
      extensions: [
        { key: "builtin:llama.cpp", source: "builtin" },
        { key: "builtin:codemode", source: "builtin" },
        { key: "builtin:tool-search", source: "builtin" },
      ],
    };
    expect(callListPiExtensions(agentDir, join(root, "repo"))).toEqual(expected);
  });

  it("returns only defaults when extensions is missing", () => {
    const root = useTempDir("tasker-pi-missing-extensions-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    writeSettings(agentDir, {});
    expect(callListPiExtensions(agentDir, join(root, "repo"))).toEqual({
      extensions: [
        { key: "builtin:llama.cpp", source: "builtin" },
        { key: "builtin:codemode", source: "builtin" },
        { key: "builtin:tool-search", source: "builtin" },
      ],
    });
  });

  it("returns only defaults when the agent folder is missing below an existing parent", () => {
    const root = useTempDir("tasker-pi-missing-agent-");
    mkdirSync(join(root, "parent"));
    expect(callListPiExtensions(join(root, "parent", "agent"), join(root, "repo"))).toEqual({
      extensions: [
        { key: "builtin:llama.cpp", source: "builtin" },
        { key: "builtin:codemode", source: "builtin" },
        { key: "builtin:tool-search", source: "builtin" },
      ],
    });
  });

  it.each([
    ["extensions is not a string list", '{"extensions":{"secret":"hidden"}}', "extensions is not a list of strings"],
    [
      "packages is a string",
      '{"packages":"secret"}',
      "packages is not a list of strings and objects with a string source",
    ],
    [
      "packages contains a number",
      '{"packages":["safe",42,"secret"]}',
      "packages is not a list of strings and objects with a string source",
    ],
    ["settings is an array", '["secret"]', "is not a JSON object"],
  ])("returns the exact reason when %s", (_label, content, message) => {
    const root = useTempDir("tasker-pi-invalid-exact-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    const file = join(agentDir, "settings.json");
    writeFileSync(file, content);
    const result = callListPiExtensions(agentDir, join(root, "repo"));
    expect(result).toEqual({
      reason: message === "is not a JSON object" ? `${file} ${message}` : `${file}: ${message}`,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("returns exact reasons for real path failures and agent containment", () => {
    const root = useTempDir("tasker-pi-real-path-");
    const repo = join(root, "repo");
    const agentDir = join(root, "agent");
    mkdirSync(repo);
    mkdirSync(agentDir);
    const missingAgent = join(root, "missing-agent-link");
    symlinkSync(join(root, "missing-agent-target"), missingAgent);
    const agentPathReason = `tasker cannot find the real path of ${missingAgent}: ENOENT`;
    expect(callListPiExtensions(missingAgent, repo)).toEqual({
      reason: agentPathReason,
    });
    expect(callPiExtensionRefusal(missingAgent, repo, [])).toBe(agentPathReason);
    const missingWorktree = join(root, "missing-worktree-link");
    symlinkSync(join(root, "missing-worktree-target"), missingWorktree);
    expect(callListPiExtensions(agentDir, missingWorktree)).toEqual({
      reason: `tasker cannot find the real path of ${missingWorktree}: ENOENT`,
    });
    const link = join(root, "agent-link");
    symlinkSync(repo, link);
    expect(callListPiExtensions(link, repo)).toEqual({ reason: `the agent folder of pi is in the worktree: ${link}` });
  });

  it("reports every settings and folder reason in order without exposing settings content", () => {
    const root = useTempDir("tasker-pi-invalid-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    const file = join(agentDir, "settings.json");
    writeFileSync(file, '{"extensions":null,"packages":[4],"token":"secret"}');
    writeFileSync(join(agentDir, "extensions"), "not a folder");
    const result = callListPiExtensions(agentDir, join(root, "repo"));
    expect(result).toEqual({
      reason: [
        `${file}: extensions is not a list of strings`,
        `${file}: packages is not a list of strings and objects with a string source`,
        `tasker cannot list ${join(agentDir, "extensions")}: ENOTDIR`,
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
    expect(callListPiExtensions(agentDir, join(root, "repo"))).toEqual({
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
    writeFileSync(join(agentDir, "extensions"), "not a folder");
    expect(callListPiExtensions(agentDir, join(root, "repo"))).toEqual({
      reason: `${expected(file)}\ntasker cannot list ${join(agentDir, "extensions")}: ENOTDIR`,
    });
  });
});
