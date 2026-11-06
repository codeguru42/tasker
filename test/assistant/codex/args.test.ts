import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codexArgs } from "../../../src/assistant/codex/args.js";
import type { Effort, RunInput } from "../../../src/assistant/provider.js";
import { expectedCodexArgs } from "../../helpers/fake-codex.js";
import { runInput, sandboxLimits } from "../../helpers/fake-claude.js";
import { useTempDir } from "../../helpers/temp.js";

function realTempDir(): string {
  return realpathSync(useTempDir("tasker-codex-table-"));
}

function argsOf(
  overrides: Partial<RunInput> = {},
  files: { threadId?: string; schemaPath?: string; hookCommand?: string } = {},
) {
  return codexArgs(runInput(overrides), files);
}

describe("codexArgs", () => {
  it("gives the arguments of a new session with no sandbox", () => {
    expect(argsOf()).toEqual(expectedCodexArgs({ model: "haiku", effort: "low" }));
  });

  it("writes one key for each denied path with JSON.stringify", () => {
    const denyRead = ["/h/.ssh", "/h/a b", '/h/q"t'];

    expect(argsOf({ sandbox: sandboxLimits({ denyRead }) })).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", denyRead }),
    );
  });

  it("gives the arguments of a continued session", () => {
    expect(argsOf({ resume: true }, { threadId: "T1" })).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", threadId: "T1" }),
    );
  });

  it("adds the schema file to a new session", () => {
    expect(argsOf({}, { schemaPath: "/s/a.schema.json" })).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", schemaPath: "/s/a.schema.json" }),
    );
  });

  it("adds the schema file to a continued session", () => {
    expect(argsOf({ resume: true }, { threadId: "T1", schemaPath: "/s/a.schema.json" })).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", threadId: "T1", schemaPath: "/s/a.schema.json" }),
    );
  });

  it("gives one key for a path that repeats", () => {
    const args = argsOf({ sandbox: sandboxLimits({ denyRead: ["/h/.ssh", "/h/.ssh"] }) });

    expect(args).toEqual(expectedCodexArgs({ model: "haiku", effort: "low", denyRead: ["/h/.ssh"] }));
    expect(args.join("\n").split('"/h/.ssh"').length - 1).toBe(1);
  });

  it("gives no write key for read-only, also with allowWrite set", () => {
    const args = argsOf({ sandbox: sandboxLimits({ allowWrite: ["/w", "/x"] }) }, { hookCommand: undefined });

    expect(args).toEqual(expectedCodexArgs({ model: "haiku", effort: "low" }));
    expect(args.join("\n")).not.toContain('"write"');
  });

  it("does not read deniedCommands", () => {
    expect(argsOf({ deniedCommands: ["git push", "herdr"] })).toEqual(argsOf());
  });

  it("never puts the prompt in the list", () => {
    expect(argsOf({ prompt: "SECRET PROMPT" }).join("\n")).not.toContain("SECRET PROMPT");
  });

  it.each<Effort>(["low", "medium", "high"])("passes the effort %s", (effort) => {
    expect(argsOf({ effort })).toContain(`model_reasoning_effort="${effort}"`);
  });

  it.each(["read-only", "workspace-write"] as const)("holds no sandbox flag and no ephemeral flag for %s", (access) => {
    const args = argsOf(
      { access, sandbox: sandboxLimits({ denyRead: ["/a"] }) },
      { threadId: "T1", schemaPath: "/s", hookCommand: "h" },
    );

    expect(args).not.toContain("-s");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("--ephemeral");
    expect(args.join("\n")).not.toContain("sandbox_mode");
  });
});

describe("codexArgs: the keys of the deny table", () => {
  function expected(denyRead: string[]) {
    return expectedCodexArgs({ model: "haiku", effort: "low", denyRead });
  }

  function deny(denyRead: string[], env: NodeJS.ProcessEnv = {}) {
    return argsOf({ env, sandbox: sandboxLimits({ denyRead }) });
  }

  it("writes the target for a deny key that is a link", () => {
    const dir = realTempDir();
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "link"));

    expect(deny([join(dir, "link")])).toEqual(expected([join(dir, "real")]));
  });

  it("leaves out a dangling link", () => {
    const dir = realTempDir();
    symlinkSync(join(dir, "missing"), join(dir, "dangling"));

    expect(deny([join(dir, "dangling"), "/h/.ssh"])).toEqual(expected(["/h/.ssh"]));
  });

  it("gives one key when a link and its target are both on the list", () => {
    const dir = realTempDir();
    writeFileSync(join(dir, "file"), "");
    symlinkSync(join(dir, "file"), join(dir, "link"));

    expect(deny([join(dir, "link"), join(dir, "file")])).toEqual(expected([join(dir, "file")]));
    expect(deny([join(dir, "file"), join(dir, "link")])).toEqual(expected([join(dir, "file")]));
  });

  it("leaves out an entry under another deny entry, also a path that exists, in each order", () => {
    const dir = realTempDir();
    mkdirSync(join(dir, "d"));
    writeFileSync(join(dir, "d", "key"), "");

    expect(deny([join(dir, "d"), join(dir, "d", "key")])).toEqual(expected([join(dir, "d")]));
    expect(deny([join(dir, "d", "key"), join(dir, "d")])).toEqual(expected([join(dir, "d")]));
    expect(deny(["/a/b", "/a/b/c/d"])).toEqual(expected(["/a/b"]));
  });

  it("keeps /a/bc beside /a/b", () => {
    expect(deny(["/a/b", "/a/bc"])).toEqual(expected(["/a/b", "/a/bc"]));
  });

  it("keeps a deny path under a file, for a read-only run", () => {
    const dir = realTempDir();
    writeFileSync(join(dir, "file"), "");
    const path = join(dir, "file", "key");

    expect(deny([path])).toEqual(expected([path]));
  });

  it("gives the table with a HOME that is a file", () => {
    const dir = realTempDir();
    writeFileSync(join(dir, "home"), "");

    expect(deny([], { HOME: join(dir, "home") })).toEqual(expected([join(dir, "home", ".config", "herdr")]));
  });

  it("leaves out a link whose target stands under a file", () => {
    const dir = realTempDir();
    writeFileSync(join(dir, "file"), "");
    symlinkSync(join(dir, "file", "x"), join(dir, "link"));

    expect(deny([join(dir, "link"), "/h/.ssh"])).toEqual(expected(["/h/.ssh"]));
  });

  it("writes the real path for a deny path through a parent link", () => {
    const dir = realTempDir();
    mkdirSync(join(dir, "real", "p"), { recursive: true });
    symlinkSync(join(dir, "real"), join(dir, "link"));

    expect(deny([join(dir, "link", "p")])).toEqual(expected([join(dir, "real", "p")]));
  });

  it("keeps a missing deny path", () => {
    expect(deny(["/tasker-no-such/path"])).toEqual(expected(["/tasker-no-such/path"]));
  });

  it("gives one key for a path that repeats", () => {
    expect(deny(["/h/x", "/h/x"])).toEqual(expected(["/h/x"]));
  });

  it("adds the herdr folder and the ssh socket for a read-only run", () => {
    const dir = realTempDir();
    writeFileSync(join(dir, "agent"), "");
    symlinkSync(join(dir, "agent"), join(dir, "agent.link"));

    expect(deny(["/h/.ssh"], { HOME: "/h", SSH_AUTH_SOCK: join(dir, "agent.link") })).toEqual(
      expected(["/h/.ssh", "/h/.config/herdr", join(dir, "agent")]),
    );
    expect(deny([], { HOME: "/h", XDG_CONFIG_HOME: "/x" })).toEqual(expected(["/x/herdr"]));
  });

  it("adds the herdr folder with no sandbox limits", () => {
    expect(argsOf({ env: { HOME: "/h" } })).toEqual(expected(["/h/.config/herdr"]));
  });

  it("leaves out the herdr folder when a denied folder holds it", () => {
    expect(deny(["/h/.config"], { HOME: "/h" })).toEqual(expected(["/h/.config"]));
  });
});

describe("codexArgs: the write profile", () => {
  const HOOK = "node '/h/main.js' '/work' '/work/.git'";

  function writeArgs(overrides: Partial<RunInput> = {}, files: Parameters<typeof argsOf>[1] = {}) {
    return argsOf({ access: "workspace-write", ...overrides }, { hookCommand: HOOK, ...files });
  }

  it("gives the exact list of a new write session", () => {
    const sandbox = sandboxLimits({ allowWrite: ["/c/objects", "/c/refs"], denyRead: ["/h/.ssh"] });

    expect(writeArgs({ env: { TMPDIR: "/t" }, sandbox }, { schemaPath: "/s/a.schema.json" })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/t", "/c/objects", "/c/refs"],
        denyRead: ["/h/.ssh"],
        hookCommand: HOOK,
        schemaPath: "/s/a.schema.json",
      }),
    );
  });

  it("gives the exact list of a continued write session", () => {
    expect(writeArgs({ resume: true, env: { TMPDIR: "/t" } }, { threadId: "T1" })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/t"],
        hookCommand: HOOK,
        threadId: "T1",
      }),
    );
  });

  it("gives a write key for /tmp when TMPDIR is not set", () => {
    expect(writeArgs()).toEqual(
      expectedCodexArgs({ model: "haiku", effort: "low", writePaths: ["/work", "/tmp"], hookCommand: HOOK }),
    );
  });

  it("gives a write key for a blank TMPDIR as /tmp", () => {
    expect(writeArgs({ env: { TMPDIR: " " } })).toEqual(writeArgs());
  });

  it("gives one deny key for a path in allowWrite and denyRead", () => {
    const sandbox = sandboxLimits({ allowWrite: ["/p"], denyRead: ["/p"] });

    expect(writeArgs({ sandbox })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp", "/p"],
        denyRead: ["/p"],
        hookCommand: HOOK,
      }),
    );
  });

  it("gives one key for a repeated path, and for a path of allowWrite that is the cwd", () => {
    const sandbox = sandboxLimits({ allowWrite: ["/work", "/x", "/x"] });

    expect(writeArgs({ sandbox })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp", "/x"],
        hookCommand: HOOK,
      }),
    );
  });

  it("writes the target for a write key that is a link", () => {
    const dir = realpathSync(useTempDir("tasker-codex-write-"));
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "link"));

    expect(writeArgs({ sandbox: sandboxLimits({ allowWrite: [join(dir, "link")] }) })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp", join(dir, "real")],
        hookCommand: HOOK,
      }),
    );
  });

  it("keeps a deny key under a write key", () => {
    expect(writeArgs({ sandbox: sandboxLimits({ denyRead: ["/work/secret"] }) })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp"],
        denyRead: ["/work/secret"],
        hookCommand: HOOK,
      }),
    );
  });

  it.each([
    ["/p", "/p/x"],
    ["/p/x", "/p"],
  ])("gives no write key for a denied path under a denied folder (%s, %s)", (first, second) => {
    const sandbox = sandboxLimits({ allowWrite: ["/p/x"], denyRead: [first, second] });

    expect(writeArgs({ sandbox })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp"],
        denyRead: ["/p"],
        hookCommand: HOOK,
      }),
    );
  });

  it("gives no write key for a path under a deny folder, even when the path is not denied itself", () => {
    const sandbox = sandboxLimits({ allowWrite: ["/p/y"], denyRead: ["/p"] });

    expect(writeArgs({ sandbox })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp"],
        denyRead: ["/p"],
        hookCommand: HOOK,
      }),
    );
  });

  it("gives no write key for a path above a deny path that lies under a deny folder", () => {
    const sandbox = sandboxLimits({ allowWrite: ["/p/x"], denyRead: ["/p", "/p/x/secret"] });

    expect(writeArgs({ sandbox })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp"],
        denyRead: ["/p"],
        hookCommand: HOOK,
      }),
    );
  });

  it("keeps the write key and the deny key of a deny path under a write path", () => {
    const sandbox = sandboxLimits({ allowWrite: ["/p"], denyRead: ["/p/x"] });

    expect(writeArgs({ sandbox })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp", "/p"],
        denyRead: ["/p/x"],
        hookCommand: HOOK,
      }),
    );
  });

  it("gives no write key when a write path and a deny path name one folder through a parent link", () => {
    const dir = realpathSync(useTempDir("tasker-codex-write-"));
    mkdirSync(join(dir, "real", "p"), { recursive: true });
    symlinkSync(join(dir, "real"), join(dir, "link"));
    const sandbox = sandboxLimits({ allowWrite: [join(dir, "link", "p")], denyRead: [join(dir, "real", "p")] });

    expect(writeArgs({ sandbox })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp"],
        denyRead: [join(dir, "real", "p")],
        hookCommand: HOOK,
      }),
    );
  });

  it("gives no write key for a write path that is a link to a denied path", () => {
    const dir = realpathSync(useTempDir("tasker-codex-write-"));
    mkdirSync(join(dir, "real"));
    symlinkSync(join(dir, "real"), join(dir, "link"));
    const sandbox = sandboxLimits({ allowWrite: [join(dir, "link")], denyRead: [join(dir, "real")] });

    expect(writeArgs({ sandbox })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp"],
        denyRead: [join(dir, "real")],
        hookCommand: HOOK,
      }),
    );
  });

  it("keeps a deny path under a file, for a write run", () => {
    const dir = realpathSync(useTempDir("tasker-codex-write-"));
    writeFileSync(join(dir, "file"), "");
    const path = join(dir, "file", "key");

    expect(writeArgs({ sandbox: sandboxLimits({ denyRead: [path] }) })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp"],
        denyRead: [path],
        hookCommand: HOOK,
      }),
    );
  });

  it.each(["read-only", "workspace-write"] as const)(
    "deduplicates the SSH socket under XDG_RUNTIME_DIR for %s",
    (access) => {
      const dir = realTempDir();
      const runtime = join(dir, "runtime");
      mkdirSync(runtime);
      const agent = join(runtime, "agent");
      writeFileSync(agent, "");
      const args = argsOf({ access, env: { XDG_RUNTIME_DIR: runtime, SSH_AUTH_SOCK: agent } });
      expect(args).toEqual(
        expectedCodexArgs({
          model: "haiku",
          effort: "low",
          ...(access === "workspace-write" ? { writePaths: ["/work", "/tmp"] } : {}),
          denyRead: [runtime],
        }),
      );
      expect(args.join("\n").split(JSON.stringify(agent)).length - 1).toBe(0);
    },
  );

  it("uses real paths for a runtime folder through a linked parent", () => {
    const dir = realTempDir();
    const realParent = join(dir, "real");
    mkdirSync(realParent);
    const link = join(dir, "parent.link");
    symlinkSync(realParent, link);
    mkdirSync(join(realParent, "runtime"));
    const runtime = join(link, "runtime");
    const args = argsOf({ env: { XDG_RUNTIME_DIR: runtime } });
    expect(args).toEqual(expectedCodexArgs({ model: "haiku", effort: "low", denyRead: [join(realParent, "runtime")] }));
  });

  it("adds the herdr folder for a write run", () => {
    expect(writeArgs({ env: { HOME: "/h" } })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work", "/tmp"],
        denyRead: ["/h/.config/herdr"],
        hookCommand: HOOK,
      }),
    );
  });

  it("gives no TMPDIR write key under the runtime deny folder", () => {
    const dir = realTempDir();
    const runtime = join(dir, "runtime");
    mkdirSync(runtime);
    const tmp = join(runtime, "tmp");
    mkdirSync(tmp);
    expect(writeArgs({ env: { XDG_RUNTIME_DIR: runtime, TMPDIR: tmp } })).toEqual(
      expectedCodexArgs({
        model: "haiku",
        effort: "low",
        writePaths: ["/work"],
        denyRead: [runtime],
        hookCommand: HOOK,
      }),
    );
  });

  it("gives the hook arguments only with hookCommand", () => {
    expect(argsOf({ access: "workspace-write" })).not.toContain("--dangerously-bypass-hook-trust");
    expect(writeArgs()).toContain("--dangerously-bypass-hook-trust");
  });

  it("writes a command with a quote as a valid TOML string", () => {
    const command = `node 'a"b' \\x`;
    const hook = writeArgs({}, { hookCommand: command }).find((arg) => arg.startsWith("hooks.PreToolUse="));

    expect(hook).toContain(`command=${JSON.stringify(command)}, timeout=10`);
    expect(JSON.parse(JSON.stringify(command))).toBe(command);
  });
});
