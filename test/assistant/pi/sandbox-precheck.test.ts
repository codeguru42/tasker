import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import type { RunInput, RunOutcome } from "../../../src/assistant/provider.js";
import type { PiSandboxLimits } from "../../../src/assistant/pi/guard-limits.js";
import { runInput, sandboxLimits } from "../../helpers/fake-claude.js";
import { useFakeSandboxBin, writeFakeCommand } from "../../helpers/fake-commands.js";
import { useTempDir } from "../../helpers/temp.js";
import { describe, expect, it } from "vitest";

interface PrecheckModule {
  runSandboxPrecheck(
    input: RunInput,
    start: (sandbox: PiSandboxLimits) => Promise<RunOutcome>,
    options?: { probeTimeoutMs?: number },
  ): Promise<RunOutcome>;
}

async function precheckModule(): Promise<PrecheckModule> {
  const path = resolve(process.cwd(), "src/assistant/pi/sandbox-precheck.js");
  return (await import(path)) as PrecheckModule;
}

function failure(input: RunInput, reason: string): Extract<RunOutcome, { kind: "failure" }> {
  return {
    kind: "failure",
    sessionId: input.sessionId,
    events: [],
    permissionDenials: [],
    usage: "unavailable",
    exitCode: null,
    signal: null,
    reason,
  };
}

function reasonOf(result: RunOutcome): string {
  if (result.kind !== "failure") throw new Error(`expected failure, got ${result.kind}`);
  return result.reason;
}

function setup() {
  const root = useTempDir("tasker-pi-precheck-");
  const worktree = join(root, "worktree");
  const write = join(worktree, "write");
  const tempRoot = join(root, "child-tmp");
  const bin = useFakeSandboxBin();
  mkdirSync(join(worktree, ".git"), { recursive: true });
  mkdirSync(write, { recursive: true });
  mkdirSync(tempRoot);
  const env = {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    TMPDIR: tempRoot,
    TASKER_FAKE_BWRAP_ARGS: join(root, "bwrap-args"),
  };
  const input = runInput({ cwd: worktree, env, sandbox: sandboxLimits({ allowWrite: [write] }) });
  return { root, worktree, write, tempRoot, bin, input };
}

async function run(input: RunInput, start: (sandbox: PiSandboxLimits) => Promise<RunOutcome>) {
  return (await precheckModule()).runSandboxPrecheck(input, start);
}

function noStart() {
  return async (): Promise<RunOutcome> => {
    throw new Error("start callback must not run");
  };
}

describe("runSandboxPrecheck", () => {
  it("refuses a missing bwrap on the child PATH before the start callback", async () => {
    const { input, root } = setup();
    const emptyBin = join(root, "empty-bin");
    mkdirSync(emptyBin);
    input.env.PATH = emptyBin;
    let starts = 0;

    const result = await run(input, async () => {
      starts += 1;
      return failure(input, "unexpected start");
    });

    expect(result.kind).toBe("failure");
    expect(reasonOf(result)).toContain("bwrap");
    expect(starts).toBe(0);
  });

  it.each([
    ["unix:abstract=SECRET_VALUE", "unix", "abstract"],
    ["tcp:host=SECRET_VALUE,port=5", "tcp", "tcp"],
    ["unix:unknown=SECRET_VALUE", "unix", "unknown"],
  ])("refuses unsupported D-Bus entry %s without exposing its value", async (address, transport, key) => {
    const { input } = setup();
    input.env.DBUS_SESSION_BUS_ADDRESS = address;

    const result = await run(input, noStart());

    expect(result.kind).toBe("failure");
    expect(reasonOf(result)).toContain(transport);
    expect(reasonOf(result)).toContain(key);
    expect(reasonOf(result)).not.toContain("SECRET_VALUE");
  });

  it("accepts a Unix D-Bus path and reaches the start callback after a successful probe", async () => {
    const { input, worktree, tempRoot } = setup();
    input.env.DBUS_SESSION_BUS_ADDRESS = "unix:path=/tmp/no-such-session-bus";
    let seen: PiSandboxLimits | undefined;

    const result = await run(input, async (sandbox) => {
      seen = sandbox;
      expect(existsSync(sandbox.tempFolder)).toBe(true);
      return failure(input, "callback reached");
    });

    expect(result.kind).toBe("failure");
    expect(reasonOf(result)).toBe("callback reached");
    expect(seen).toMatchObject({
      worktree,
      tempFolder: expect.stringContaining(tempRoot),
      writePaths: [join(worktree, "write")],
    });
  });

  it.each(["cwd", "write"] as const)("reports a missing %s path by error code only", async (which) => {
    const { input, root } = setup();
    const secretPath = join(root, `missing-${which}-SECRET`);
    if (which === "cwd") input.cwd = secretPath;
    else input.sandbox = sandboxLimits({ allowWrite: [secretPath] });

    const result = await run(input, noStart());

    expect(result.kind).toBe("failure");
    expect(reasonOf(result)).toContain("ENOENT");
    expect(reasonOf(result)).not.toContain(secretPath);
  });

  it("reports temp-folder creation failure and does not call the start callback", async () => {
    const { input, root } = setup();
    input.env.TMPDIR = join(root, "missing-temp-root");
    let starts = 0;

    const result = await run(input, async () => {
      starts += 1;
      return failure(input, "unexpected start");
    });

    expect(result.kind).toBe("failure");
    expect(reasonOf(result)).toContain("ENOENT");
    expect(reasonOf(result)).not.toContain(input.env.TMPDIR);
    expect(starts).toBe(0);
  });

  it.each(["equal cwd", "above cwd", "equal write", "above write", "above temp"] as const)(
    "refuses a hide path %s",
    async (overlap) => {
      const { input, root, worktree, write, tempRoot } = setup();
      const paths: Record<typeof overlap, string> = {
        "equal cwd": worktree,
        "above cwd": root,
        "equal write": write,
        "above write": worktree,
        "above temp": tempRoot,
      };
      input.sandbox = sandboxLimits({ allowWrite: [write], denyRead: [paths[overlap]] });

      const result = await run(input, noStart());

      expect(result.kind).toBe("failure");
      expect(reasonOf(result)).toContain("overlap");
      expect(reasonOf(result)).not.toContain(paths[overlap]);
    },
  );

  it("allows a hide path below or beside a write path", async () => {
    const { input, worktree, write } = setup();
    const below = join(write, "hidden");
    const beside = join(worktree, "beside");
    mkdirSync(below);
    mkdirSync(beside);
    input.sandbox = sandboxLimits({ allowWrite: [write], denyRead: [below, beside] });
    let starts = 0;

    const result = await run(input, async () => {
      starts += 1;
      return failure(input, "pass");
    });

    expect(result.kind).toBe("failure");
    expect(reasonOf(result)).toBe("pass");
    expect(starts).toBe(1);
  });

  it("reports a nonmissing hide resolve error by code without a path", async () => {
    const { input, root } = setup();
    const cycle = join(root, "cycle");
    input.sandbox!.denyRead = [cycle];
    symlinkSync("cycle", cycle);

    const result = await run(input, noStart());

    expect(result.kind).toBe("failure");
    expect(reasonOf(result)).toContain("ELOOP");
    expect(reasonOf(result)).not.toContain(cycle);
  });

  it("reports a failed probe with its exit code and first stderr line, without hide mounts", async () => {
    const { input, bin, root, worktree } = setup();
    const hidden = join(root, "private-hide-path");
    mkdirSync(hidden);
    input.sandbox = sandboxLimits({ allowWrite: [join(worktree, "write")], denyRead: [hidden] });
    writeFakeCommand(
      bin,
      "bwrap",
      [
        'printf "%s\\0" "$@" > "$TASKER_FAKE_BWRAP_ARGS"',
        "printf 'first probe error\\nsecond error\\n' >&2",
        "exit 23",
      ].join("\n"),
    );

    const result = await run(input, noStart());

    expect(result.kind).toBe("failure");
    expect(reasonOf(result)).toContain("23");
    expect(reasonOf(result)).toContain("first probe error");
    expect(reasonOf(result)).not.toContain("second error");
    expect(readFileSync(input.env.TASKER_FAKE_BWRAP_ARGS!, "utf8")).not.toContain(hidden);
    expect(readFileSync(input.env.TASKER_FAKE_BWRAP_ARGS!, "utf8")).not.toContain("--tmpfs");
  });

  it("kills a timed out probe process group and does not call start", async () => {
    const { input, bin, root } = setup();
    const marker = join(root, "probe-finished");
    writeFakeCommand(bin, "bwrap", `sleep 0.2; touch '${marker}'`);
    let starts = 0;
    const module = await precheckModule();

    const result = await module.runSandboxPrecheck(
      input,
      async () => {
        starts += 1;
        return failure(input, "unexpected start");
      },
      { probeTimeoutMs: 20 },
    );
    await new Promise((done) => setTimeout(done, 250));

    expect(result.kind).toBe("failure");
    expect(reasonOf(result)).toContain("timeout");
    expect(existsSync(marker)).toBe(false);
    expect(starts).toBe(0);
  });

  it("probes with true, the real cwd, and the same non-hide argument builder", async () => {
    const { input, worktree, root } = setup();
    const hidden = join(root, "hidden-for-real-call");
    mkdirSync(hidden);
    input.sandbox = sandboxLimits({ allowWrite: [join(worktree, "write")], denyRead: [hidden] });
    let callbackReached = false;

    const result = await run(input, async (sandbox) => {
      callbackReached = true;
      expect(existsSync(sandbox.tempFolder)).toBe(true);
      return failure(input, "passed");
    });
    const args = readFileSync(input.env.TASKER_FAKE_BWRAP_ARGS!, "utf8").split("\0");

    expect(result.kind).toBe("failure");
    expect(reasonOf(result)).toBe("passed");
    expect(callbackReached).toBe(true);
    expect(args).toContain("--chdir");
    expect(args[args.indexOf("--chdir") + 1]).toBe(worktree);
    expect(args.slice(-3)).toEqual([existsSync("/bin/bash") ? "/bin/bash" : "bash", "-c", "true"]);
    expect(args).not.toContain(hidden);
    expect(args).not.toContain("--tmpfs");
  });
});
