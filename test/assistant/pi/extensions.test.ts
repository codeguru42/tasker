import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../../helpers/temp.js";
import {
  listPiExtensions as listExtensions,
  piExtensionRefusal as refusalFor,
  maskExtensionKey as maskKey,
} from "../../../src/assistant/pi/extensions.js";

function listPiExtensions(agentDir: string, worktree: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return listExtensions(agentDir, worktree);
}

function piExtensionRefusal(
  extensions: Parameters<typeof listPiExtensions>[0] extends never ? never : unknown[],
  trusted: string[],
) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return refusalFor(extensions, trusted);
}

function maskExtensionKey(key: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return maskKey(key);
}

function writeSettings(agentDir: string, value: unknown) {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(value));
}

describe("pi extension keys", () => {
  it("lists folder, settings, package and built-in entries in source order", () => {
    const root = useTempDir("tasker-pi-extensions-");
    const agentDir = join(root, "agent");
    mkdirSync(join(agentDir, "extensions"), { recursive: true });
    writeFileSync(join(agentDir, "extensions", "z.js"), "");
    mkdirSync(join(agentDir, "extensions", "a"));
    writeSettings(agentDir, {
      extensions: ["+one", "-gone", "!ignored", "builtin:codemode"],
      packages: ["pkg", { source: "https://user:secret@example.com/pkg" }],
    });

    const entries = listPiExtensions(agentDir, join(root, "repo"));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect(entries.map((entry: { key: string }) => entry.key)).toEqual([
      join(agentDir, "extensions", "a"),
      join(agentDir, "extensions", "z.js"),
      "one",
      "builtin:codemode",
      "https://user:secret@example.com/pkg",
      "builtin:llama.cpp",
      "builtin:tool-search",
    ]);
  });

  it("keeps exact keys, removes only removable built-ins, and reports untrusted keys", () => {
    const root = useTempDir("tasker-pi-refusal-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir, { recursive: true });
    writeSettings(agentDir, { extensions: ["-builtin:codemode", "+builtin:codemode", "pkg"] });
    const entries = listPiExtensions(agentDir, join(root, "repo"));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    expect(entries.map((entry: { key: string }) => entry.key)).toContain("builtin:codemode");
    expect(piExtensionRefusal(entries, ["pkg"])).toContain("builtin:codemode");
    expect(piExtensionRefusal(entries, ["pkg-prefix"])).toContain("builtin:codemode");
    expect(piExtensionRefusal(entries, ["pkg", "builtin:codemode"])).toBeUndefined();
  });

  it("rejects real paths inside the worktree and masks URL user data", () => {
    const root = useTempDir("tasker-pi-real-path-");
    const repo = join(root, "repo");
    const agentDir = join(root, "agent");
    mkdirSync(repo);
    mkdirSync(agentDir);
    const link = join(root, "agent-link");
    symlinkSync(repo, link);
    const result = listPiExtensions(link, repo);
    expect(result).toEqual(expect.objectContaining({ reason: expect.stringContaining("worktree") }));
    expect(maskExtensionKey("https://alice:secret@example.com/path")).toBe("https://***@example.com/path");
    expect(maskExtensionKey("ssh://alice@host")).toBe("ssh://***@host");
  });

  it("reports settings and folder failures without exposing file contents", () => {
    const root = useTempDir("tasker-pi-invalid-");
    const agentDir = join(root, "agent");
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, "settings.json"), '{"extensions":null,"token":"secret"}');
    const result = listPiExtensions(agentDir, join(root, "repo"));
    expect(result).toEqual(expect.objectContaining({ reason: expect.stringContaining("extensions") }));
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
