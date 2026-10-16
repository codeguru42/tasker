import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { removePlaceholders } from "../../../src/assistant/claude-code/placeholders.js";
import { writePlaceholder } from "../../helpers/fake-claude.js";
import { useTempDir } from "../../helpers/temp.js";

const none = async () => [] as string[];

function setUp() {
  return useTempDir("tasker-placeholders-");
}

describe("removePlaceholders", () => {
  function linkClaudeTo(cwd: string) {
    const target = useTempDir("tasker-placeholders-target-");
    mkdirSync(join(target, "agents"));
    writePlaceholder(target, "settings.json");
    symlinkSync(target, join(cwd, ".claude"));
    return target;
  }

  it("removes an empty read-only file at the root and in .claude", async () => {
    const cwd = setUp();
    writePlaceholder(cwd, ".bashrc");
    writePlaceholder(cwd, ".mcp.json");
    writePlaceholder(cwd, ".claude/settings.json");
    writePlaceholder(cwd, ".claude/loop.md");

    const result = await removePlaceholders(cwd, none);

    expect(result).toEqual({
      removed: [".bashrc", ".claude", ".claude/loop.md", ".claude/settings.json", ".mcp.json"],
    });
    for (const name of [".bashrc", ".mcp.json", ".claude/settings.json", ".claude/loop.md"]) {
      expect(existsSync(join(cwd, name))).toBe(false);
    }
  });

  it("removes the empty folders, then .cc-writes, then .claude last", async () => {
    const cwd = setUp();
    for (const name of ["agents", "skills", ".cc-writes"]) mkdirSync(join(cwd, ".claude", name), { recursive: true });

    const result = await removePlaceholders(cwd, none);

    expect(result).toEqual({ removed: [".claude", ".claude/.cc-writes", ".claude/agents", ".claude/skills"] });
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  it("gives a sorted, relative list", async () => {
    const cwd = setUp();
    writePlaceholder(cwd, ".zshrc");
    writePlaceholder(cwd, ".bash_profile");
    writePlaceholder(cwd, ".claude/hooks");

    const result = await removePlaceholders(cwd, none);

    expect(result).toEqual({ removed: [".bash_profile", ".claude/hooks", ".claude", ".zshrc"].sort() });
  });

  it("keeps a tracked placeholder, and asks about the existing candidates in one call", async () => {
    const cwd = setUp();
    writePlaceholder(cwd, ".bashrc");
    writePlaceholder(cwd, ".gitconfig");
    const tracked = vi.fn(async (paths: readonly string[]) => paths.filter((p) => p === ".bashrc"));

    const result = await removePlaceholders(cwd, tracked);

    expect(result).toEqual({ removed: [".gitconfig"] });
    expect(existsSync(join(cwd, ".bashrc"))).toBe(true);
    expect(tracked).toHaveBeenCalledTimes(1);
    expect(tracked.mock.calls[0]![0]).toEqual([".bashrc", ".gitconfig"]);
  });

  it("makes no trackedPaths call with no candidate", async () => {
    const cwd = setUp();
    writeFileSync(join(cwd, "other.txt"), "x");
    const tracked = vi.fn(none);

    expect(await removePlaceholders(cwd, tracked)).toEqual({ removed: [] });
    expect(tracked).not.toHaveBeenCalled();
  });

  it("keeps a non-empty file, a writable file and a file with two links", async () => {
    const cwd = setUp();
    writeFileSync(join(cwd, ".bashrc"), "data", { mode: 0o444 });
    writeFileSync(join(cwd, ".zshrc"), "", { mode: 0o644 });
    writePlaceholder(cwd, ".profile");
    linkSync(join(cwd, ".profile"), join(cwd, "linked"));

    const result = await removePlaceholders(cwd, none);

    expect(result).toEqual({ removed: [] });
    for (const name of [".bashrc", ".zshrc", ".profile"]) expect(existsSync(join(cwd, name))).toBe(true);
  });

  it("keeps a symlink to an empty read-only file", async () => {
    const cwd = setUp();
    writePlaceholder(cwd, "target");
    symlinkSync(join(cwd, "target"), join(cwd, ".bashrc"));

    expect(await removePlaceholders(cwd, none)).toEqual({ removed: [] });
    expect(existsSync(join(cwd, "target"))).toBe(true);
    expect(existsSync(join(cwd, ".bashrc"))).toBe(true);
  });

  it("keeps a name that is not on the lists", async () => {
    const cwd = setUp();
    writePlaceholder(cwd, "notes.txt");
    writePlaceholder(cwd, ".claude/other.json");

    const result = await removePlaceholders(cwd, none);

    expect(result).toEqual({ removed: [] });
    expect(existsSync(join(cwd, "notes.txt"))).toBe(true);
    expect(existsSync(join(cwd, ".claude", "other.json"))).toBe(true);
  });

  it("keeps a folder at the root, such as .vscode, even when it is empty", async () => {
    const cwd = setUp();
    mkdirSync(join(cwd, ".vscode"));
    mkdirSync(join(cwd, ".idea"));

    expect(await removePlaceholders(cwd, none)).toEqual({ removed: [] });
    expect(existsSync(join(cwd, ".vscode"))).toBe(true);
    expect(existsSync(join(cwd, ".idea"))).toBe(true);
  });

  it("removes an empty .vscode file at the root", async () => {
    const cwd = setUp();
    writePlaceholder(cwd, ".vscode");

    expect(await removePlaceholders(cwd, none)).toEqual({ removed: [".vscode"] });
  });

  it("keeps a .claude that is not empty, and a folder with a file in it", async () => {
    const cwd = setUp();
    writePlaceholder(cwd, ".claude/settings.json");
    writeFileSync(join(cwd, ".claude", "mine.md"), "x");
    mkdirSync(join(cwd, ".claude", "agents"));
    writeFileSync(join(cwd, ".claude", "agents", "a.md"), "x");

    const result = await removePlaceholders(cwd, none);

    expect(result).toEqual({ removed: [".claude/settings.json"] });
    expect(existsSync(join(cwd, ".claude", "agents", "a.md"))).toBe(true);
    expect(existsSync(join(cwd, ".claude", "mine.md"))).toBe(true);
  });

  it("does not treat an entry that is gone in the meantime as an error", async () => {
    const cwd = setUp();
    writePlaceholder(cwd, ".bashrc");
    writePlaceholder(cwd, ".zshrc");
    const racing = async () => {
      rmSync(join(cwd, ".bashrc"));
      return [];
    };

    expect(await removePlaceholders(cwd, racing)).toEqual({ removed: [".zshrc"] });
  });

  it("treats the .claude entries as not there when .claude is a regular file", async () => {
    const cwd = setUp();
    writeFileSync(join(cwd, ".claude"), "mine\n");
    writePlaceholder(cwd, ".bashrc");
    writePlaceholder(cwd, ".mcp.json");

    const result = await removePlaceholders(cwd, none);

    expect(result).toEqual({ removed: [".bashrc", ".mcp.json"] });
    expect(existsSync(join(cwd, ".bashrc"))).toBe(false);
    expect(existsSync(join(cwd, ".mcp.json"))).toBe(false);
    expect(readFileSync(join(cwd, ".claude"), "utf8")).toBe("mine\n");
  });

  it("gives the error and leaves the files when trackedPaths rejects", async () => {
    const cwd = setUp();
    writePlaceholder(cwd, ".bashrc");

    const result = await removePlaceholders(cwd, async () => {
      throw new Error("git failed");
    });

    expect(result).toEqual({ error: "git failed" });
    expect(existsSync(join(cwd, ".bashrc"))).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)("gives the fs error code and not the path", async () => {
    const cwd = setUp();
    chmodSync(cwd, 0o000);

    try {
      const result = await removePlaceholders(cwd, none);

      expect(result).toEqual({ error: "cannot remove the sandbox placeholders: EACCES" });
      expect(JSON.stringify(result)).not.toContain(cwd);
    } finally {
      chmodSync(cwd, 0o755);
    }
  });

  it("follows no .claude symlink, and keeps the entries of its target", async () => {
    const cwd = setUp();
    const target = linkClaudeTo(cwd);
    writePlaceholder(cwd, ".bashrc");
    writePlaceholder(cwd, ".mcp.json");

    const result = await removePlaceholders(cwd, none);

    expect(result).toEqual({ removed: [".bashrc", ".mcp.json"] });
    expect(existsSync(join(target, "agents"))).toBe(true);
    expect(existsSync(join(target, "settings.json"))).toBe(true);
    expect(lstatSync(join(cwd, ".claude")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(cwd, ".bashrc"))).toBe(false);
    expect(existsSync(join(cwd, ".mcp.json"))).toBe(false);
  });

  it("asks trackedPaths about no path under a .claude symlink", async () => {
    const cwd = setUp();
    linkClaudeTo(cwd);
    writePlaceholder(cwd, ".bashrc");
    const tracked = vi.fn<(paths: readonly string[]) => Promise<string[]>>(async () => []);

    await removePlaceholders(cwd, tracked);

    expect(tracked).toHaveBeenCalledTimes(1);
    expect(tracked.mock.calls[0]![0].filter((path) => path.startsWith(".claude/"))).toEqual([]);
  });
});
