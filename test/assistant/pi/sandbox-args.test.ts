import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PiSandboxLimits } from "../../../src/assistant/pi/guard-limits.js";
import { useTempDir } from "../../helpers/temp.js";

interface SandboxArgsInput {
  sandbox: PiSandboxLimits;
  cwd: string;
  command: string;
  env: NodeJS.ProcessEnv;
}

type SandboxArgsResult = { args: string[] } | { reason: string };

async function sandboxArgs(input: SandboxArgsInput): Promise<SandboxArgsResult> {
  const modulePath = resolve(process.cwd(), "src/assistant/pi/sandbox-args.js");
  const module = (await import(modulePath)) as {
    sandboxArgs(input: SandboxArgsInput): SandboxArgsResult;
  };
  return module.sandboxArgs(input);
}

function setup() {
  const root = useTempDir("tasker-pi-mounts-");
  const worktree = join(root, "worktree");
  const write = join(worktree, "write");
  const temp = join(root, "temp");
  mkdirSync(join(worktree, ".git"), { recursive: true });
  mkdirSync(write, { recursive: true });
  mkdirSync(temp);
  const sandbox: PiSandboxLimits = {
    bwrap: "/usr/bin/bwrap",
    worktree,
    writePaths: [write],
    tempFolder: temp,
    hidePaths: [],
  };
  return { root, worktree, write, temp, sandbox };
}

async function argsFor(input: SandboxArgsInput): Promise<string[]> {
  const result = await sandboxArgs(input);
  if ("reason" in result) throw new Error(result.reason);
  return result.args;
}

function hideIndex(args: string[], flag: string, path: string): number {
  return args.findIndex((value, index) => value === flag && args[index + 1] === path);
}

describe("sandboxArgs", () => {
  it("builds the required arguments in order", async () => {
    const { worktree, write, temp, sandbox } = setup();
    const hideDir = join(worktree, "hidden");
    mkdirSync(hideDir);
    const hideFile = join(worktree, "secret");
    writeFileSync(hideFile, "secret");
    sandbox.hidePaths = [hideDir, hideFile];
    const command = "printf safe";

    const args = await argsFor({ sandbox, cwd: worktree, command, env: {} });

    expect(args).toEqual([
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--bind",
      worktree,
      worktree,
      "--bind",
      write,
      write,
      "--bind",
      temp,
      temp,
      "--ro-bind",
      join(worktree, ".git"),
      join(worktree, ".git"),
      "--tmpfs",
      hideDir,
      "--ro-bind",
      "/dev/null",
      hideFile,
      "--unshare-pid",
      "--new-session",
      "--die-with-parent",
      "--setenv",
      "TMPDIR",
      temp,
      "--chdir",
      worktree,
      "--",
      existsSync("/bin/bash") ? "/bin/bash" : "bash",
      "-c",
      command,
    ]);
  });

  it.each([
    ["the cwd", (s: PiSandboxLimits, worktree: string) => worktree, "cwd"],
    [
      "an ancestor of cwd",
      (s: PiSandboxLimits, worktree: string) => worktree.slice(0, worktree.lastIndexOf("/")),
      "cwd",
    ],
    ["the temp folder", (s: PiSandboxLimits) => s.tempFolder, "temp"],
    ["an ancestor of temp", (s: PiSandboxLimits) => s.tempFolder.slice(0, s.tempFolder.lastIndexOf("/")), "temp"],
    ["the write path", (s: PiSandboxLimits) => s.writePaths[0], "write"],
    [
      "an ancestor of a write path",
      (s: PiSandboxLimits) => s.writePaths[0].slice(0, s.writePaths[0].lastIndexOf("/")),
      "write",
    ],
  ])("blocks a hide path equal to or above %s", async (_label, choosePath) => {
    const { worktree, sandbox } = setup();
    sandbox.hidePaths = [choosePath(sandbox, worktree)];

    const result = await sandboxArgs({ sandbox, cwd: worktree, command: "true", env: {} });

    expect(result).toHaveProperty("reason");
    expect("reason" in result ? result.reason : "").not.toContain(sandbox.hidePaths[0]);
  });

  it("allows a hide path below and beside a write path, after writable binds", async () => {
    const { worktree, write, sandbox } = setup();
    const nested = join(write, "hidden");
    const beside = join(worktree, "beside");
    mkdirSync(nested);
    mkdirSync(beside);
    sandbox.hidePaths = [nested, beside];

    const args = await argsFor({ sandbox, cwd: worktree, command: "true", env: {} });

    expect(hideIndex(args, "--tmpfs", nested)).toBeGreaterThan(args.indexOf(write));
    expect(hideIndex(args, "--tmpfs", beside)).toBeGreaterThan(args.indexOf(write));
  });

  it.each([
    ["denyRead", "hide-deny"],
    ["herdr by XDG_CONFIG_HOME", "hide-herdr-xdg"],
    ["herdr by HOME", "hide-herdr-home"],
    ["SSH_AUTH_SOCK", "hide-ssh"],
    ["D-Bus", "hide-dbus"],
    ["XDG_RUNTIME_DIR", "hide-runtime"],
    ["Docker", "hide-docker"],
  ])("mounts a configured %s hide target", async (_name, source) => {
    const { root, worktree, sandbox } = setup();
    const path = join(root, source);
    mkdirSync(path);
    sandbox.hidePaths = [path];

    const args = await argsFor({ sandbox, cwd: worktree, command: "true", env: {} });

    expect(args).toContain("--tmpfs");
    expect(args).toContain(path);
  });

  it.each(["ENOENT", "ENOTDIR"])("omits a hide target on %s", async (code) => {
    const { worktree, sandbox } = setup();
    sandbox.hidePaths = [code === "ENOENT" ? "/missing/tasker-hide" : join(worktree, ".git", "child")];

    const args = await argsFor({ sandbox, cwd: worktree, command: "true", env: {} });

    expect(args).not.toContain(sandbox.hidePaths[0]);
  });

  it("uses the real path and mount kind for directory and file links", async () => {
    const { root, worktree, sandbox } = setup();
    const targetDir = join(root, "target-dir");
    const targetFile = join(root, "target-file");
    mkdirSync(targetDir);
    writeFileSync(targetFile, "hidden");
    const dirLink = join(root, "dir-link");
    const fileLink = join(root, "file-link");
    symlinkSync(targetDir, dirLink);
    symlinkSync(targetFile, fileLink);
    sandbox.hidePaths = [dirLink, fileLink];

    const args = await argsFor({ sandbox, cwd: worktree, command: "true", env: {} });

    expect(hideIndex(args, "--tmpfs", targetDir)).toBeGreaterThan(-1);
    expect(hideIndex(args, "--ro-bind", "/dev/null")).toBeGreaterThan(-1);
    expect(args).toContain(targetFile);
    expect(args).not.toContain(dirLink);
    expect(args).not.toContain(fileLink);
  });

  it("binds a pipe as a hidden non-directory", async () => {
    const { root, worktree, sandbox } = setup();
    const pipe = join(root, "hidden-pipe");
    const created = spawnSync("mkfifo", [pipe]);
    expect(created.status).toBe(0);
    sandbox.hidePaths = [pipe];

    const args = await argsFor({ sandbox, cwd: worktree, command: "true", env: {} });

    expect(hideIndex(args, "--ro-bind", "/dev/null")).toBeGreaterThan(-1);
    expect(args).toContain(pipe);
  });

  it("omits dangling links and blocks other resolve errors without showing paths", async () => {
    const { root, worktree, sandbox } = setup();
    const dangling = join(root, "dangling");
    const loopA = join(root, "loop-a");
    const loopB = join(root, "loop-b");
    symlinkSync(join(root, "absent"), dangling);
    symlinkSync(loopB, loopA);
    symlinkSync(loopA, loopB);
    sandbox.hidePaths = [dangling];

    const omitted = await argsFor({ sandbox, cwd: worktree, command: "true", env: {} });
    sandbox.hidePaths = [loopA];
    const blocked = await sandboxArgs({ sandbox, cwd: worktree, command: "true", env: {} });

    expect(omitted).not.toContain(dangling);
    expect(blocked).toHaveProperty("reason");
    expect(JSON.stringify(blocked)).toContain("ELOOP");
    expect(JSON.stringify(blocked)).not.toContain(loopA);
  });

  it("hides a socket target at its real path and resolves SSH_AUTH_SOCK on each call", async () => {
    const { root, worktree, sandbox } = setup();
    const first = join(root, "first.sock");
    const second = join(root, "second.sock");
    const link = join(root, "agent.sock");
    const server = createServer();
    await new Promise<void>((done) => server.listen(first, done));
    symlinkSync(first, link);
    sandbox.hidePaths = [];
    const env = { SSH_AUTH_SOCK: link };
    const args = await argsFor({ sandbox, cwd: worktree, command: "true", env });
    await new Promise<void>((done) => server.close(() => done()));
    const next = createServer();
    await new Promise<void>((done) => next.listen(second, done));
    symlinkSync(second, link);
    const changed = await argsFor({ sandbox, cwd: worktree, command: "true", env });
    await new Promise<void>((done) => next.close(() => done()));

    expect(args).toContain(first);
    expect(changed).toContain(second);
    expect(hideIndex(args, "--ro-bind", "/dev/null")).toBeGreaterThan(-1);
  });

  it("omits a missing SSH_AUTH_SOCK and blocks a broken socket link without its path", async () => {
    const { root, worktree, sandbox } = setup();
    const missing = join(root, "missing-agent");
    sandbox.hidePaths = [];
    const args = await argsFor({ sandbox, cwd: worktree, command: "true", env: { SSH_AUTH_SOCK: missing } });
    const loop = join(root, "agent-loop");
    symlinkSync(loop, loop);
    const blocked = await sandboxArgs({ sandbox, cwd: worktree, command: "true", env: { SSH_AUTH_SOCK: loop } });

    expect(args).not.toContain(missing);
    expect(JSON.stringify(blocked)).toContain("ELOOP");
    expect(JSON.stringify(blocked)).not.toContain(loop);
  });

  it("decodes D-Bus path escapes and rejects abstract or network addresses", async () => {
    const { root, worktree, sandbox } = setup();
    const socketPath = join(root, "dbus path");
    mkdirSync(socketPath);
    const escaped = encodeURIComponent(socketPath).replaceAll("%2F", "/");
    const args = await argsFor({
      sandbox,
      cwd: worktree,
      command: "true",
      env: { DBUS_SESSION_BUS_ADDRESS: `unix:path=${escaped}` },
    });
    const abstract = await sandboxArgs({
      sandbox,
      cwd: worktree,
      command: "true",
      env: { DBUS_SESSION_BUS_ADDRESS: "unix:abstract=bus" },
    });
    const network = await sandboxArgs({
      sandbox,
      cwd: worktree,
      command: "true",
      env: { DBUS_SESSION_BUS_ADDRESS: "tcp:host=example" },
    });

    expect(args).toContain(socketPath);
    expect(abstract).toHaveProperty("reason");
    expect(network).toHaveProperty("reason");
    expect(JSON.stringify([abstract, network])).not.toContain("example");
    expect(JSON.stringify([abstract, network])).not.toContain("bus");
  });

  it("does not mount an unset or blank optional hide source", async () => {
    const { worktree, sandbox } = setup();
    const args = await argsFor({
      sandbox,
      cwd: worktree,
      command: "true",
      env: {
        SSH_AUTH_SOCK: "",
        DBUS_SESSION_BUS_ADDRESS: "",
        XDG_RUNTIME_DIR: "",
        XDG_CONFIG_HOME: "",
        HOME: "",
      },
    });

    expect(args).not.toContain("--tmpfs");
    expect(args).not.toContain("--ro-bind");
    expect(args).not.toContain("/var/run/docker.sock");
  });
});
