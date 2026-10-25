import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { childEnv } from "../../src/process/child-env.js";
import { createClaudeCodeProvider } from "../../src/assistant/claude-code/provider.js";
import type { AssistantEvent } from "../../src/assistant/provider.js";
import {
  argAfter,
  claudeApprovalWarningEvent,
  claudeOverageEvent,
  claudeRateLimitEvent,
  claudeSample,
  claudeSampleEvents,
  claudeSampleWithResult,
  noResetsAt,
  runInput,
  TEST_SESSION_ID,
  useFakeClaude,
  useFakeClaudeOnPath,
  withEventBeforeResult,
  withEventFirst,
  writePlaceholder,
} from "./fake-claude.js";
import { realCommandPath } from "./fake-commands.js";
import { isAlive, savePid, waitUntil } from "./processes.js";
import { useTempDir } from "./temp.js";

// Runs the fake claude with the env of the caller and the given stdin.
function runClaude(env: NodeJS.ProcessEnv, args: string[], input = "") {
  return spawnSync("claude", args, { env, input, encoding: "utf8" });
}

// Starts the fake claude with the async spawn and ends stdin. It saves the pid. stdout() gives the text so far,
// and exited gives the signal that ended the child.
function startClaude(env: NodeJS.ProcessEnv) {
  const child = spawn("claude", [], { env, stdio: ["pipe", "pipe", "ignore"] });
  const pid = child.pid!;
  savePid(pid);
  let out = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out += chunk;
  });
  child.stdin.end();
  const exited = new Promise<NodeJS.Signals | null>((resolve) => child.on("exit", (_code, signal) => resolve(signal)));
  return { pid, stdout: () => out, exited };
}

describe("claudeSample", () => {
  it("gives the lines of a recorded stream, with no empty last item", () => {
    const lines = claudeSample("plain");

    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0])).toMatchObject({ type: "system", subtype: "init" });
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ type: "result" });
  });
});

describe("runInput", () => {
  it("gives the defaults, with the shared session id", () => {
    expect(runInput()).toEqual({
      sessionId: TEST_SESSION_ID,
      resume: false,
      prompt: "say hello",
      cwd: "/work",
      env: {},
      timeoutMs: 20_000,
      sessionDir: "/sessions",
      model: "haiku",
      effort: "low",
    });
  });

  it("lets an override win and keeps the other defaults", () => {
    const input = runInput({ resume: true, model: "opus" });

    expect(input).toMatchObject({ resume: true, model: "opus", effort: "low", prompt: "say hello" });
  });

  it("gives a new object for each call", () => {
    const first = runInput();
    first.prompt = "changed";
    (first.env as Record<string, string>).X = "1";

    expect(runInput().prompt).toBe("say hello");
    expect(runInput().env).toEqual({});
  });
});

describe("claudeSampleEvents", () => {
  it("gives each line of a sample as a parsed event", () => {
    const events = claudeSampleEvents("plain");

    expect(events).toHaveLength(4);
    expect(events).toEqual(claudeSample("plain").map((line) => JSON.parse(line)));
  });

  it("gives new objects for each call", () => {
    claudeSampleEvents("plain")[0].type = "changed";

    expect(claudeSampleEvents("plain")[0].type).toBe("system");
  });
});

describe("claudeSampleWithResult", () => {
  it("gives the events with the last one edited", () => {
    const events = claudeSampleWithResult("plain", (result) => {
      result.is_error = true;
    });

    expect(events).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({ type: "result", is_error: true });
    expect(events.slice(0, -1)).toEqual(claudeSampleEvents("plain").slice(0, -1));
  });

  it("does not change the sample file or a later read", () => {
    const lines = claudeSample("plain");
    const events = claudeSampleEvents("plain");

    claudeSampleWithResult("plain", (result) => {
      result.is_error = true;
      delete result.usage;
    });

    expect(claudeSample("plain")).toEqual(lines);
    expect(claudeSampleEvents("plain")).toEqual(events);
  });
});

describe("claudeRateLimitEvent", () => {
  it("gives the parsed capture when it has no edit", () => {
    expect(claudeRateLimitEvent()).toEqual(JSON.parse(claudeSample("rate-limit-warning")[0]));
  });

  it("applies the edit to rate_limit_info", () => {
    const event = claudeRateLimitEvent((info) => {
      info.utilization = 0.5;
    });

    expect(event.rate_limit_info).toMatchObject({ utilization: 0.5, rateLimitType: "seven_day" });
  });

  it("gives a new object for each call, so an edit does not leak", () => {
    claudeRateLimitEvent((info) => {
      info.utilization = 0.5;
    });

    expect(claudeRateLimitEvent().rate_limit_info).toMatchObject({ utilization: 0.8 });
  });
});

describe("claudeOverageEvent", () => {
  it("gives the capture with isUsingOverage true and no other change", () => {
    const expected = claudeRateLimitEvent((info) => {
      info.isUsingOverage = true;
    });

    expect(claudeOverageEvent()).toEqual(expected);
  });

  it("runs the edit after the change", () => {
    const event = claudeOverageEvent((info) => {
      info.rateLimitType = "overage";
    });

    expect(event.rate_limit_info).toMatchObject({ isUsingOverage: true, rateLimitType: "overage" });
  });

  it("gives a new object for each call, so an edit does not leak", () => {
    claudeOverageEvent((info) => {
      info.utilization = 0.5;
    });

    expect(claudeOverageEvent().rate_limit_info).toMatchObject({ utilization: 0.8 });
  });
});

const detect = (event: AssistantEvent, threshold: number) =>
  createClaudeCodeProvider().detectQuotaApprovalWarning(
    {
      kind: "success",
      sessionId: TEST_SESSION_ID,
      events: [event],
      permissionDenials: [],
      usage: "unavailable",
    },
    threshold,
  );

describe("noResetsAt", () => {
  it("gives a warning with no reset time", () => {
    const warning = detect(claudeApprovalWarningEvent(noResetsAt), 0.9);

    expect(warning).toEqual({ utilization: 0.95 });
    expect(warning).not.toHaveProperty("resetsAt");
  });

  it("removes the reset time from the info and from the seven_day window", () => {
    const info = claudeApprovalWarningEvent(noResetsAt).rate_limit_info as {
      unifiedWindows: { seven_day: Record<string, unknown> };
    };

    expect(info).not.toHaveProperty("resetsAt");
    expect(info.unifiedWindows.seven_day).not.toHaveProperty("resetsAt");
  });
});

describe("claudeApprovalWarningEvent", () => {
  it("gives a warning of the claude-code provider at the default threshold 0.9", () => {
    expect(detect(claudeApprovalWarningEvent(), 0.9)).toEqual({ utilization: 0.95, resetsAt: 1792206000 });
  });

  it("applies the edit after the change", () => {
    const event = claudeApprovalWarningEvent((info) => {
      info.rateLimitType = "five_hour";
    });

    expect(event.rate_limit_info).toMatchObject({ utilization: 0.95, rateLimitType: "five_hour" });
  });

  it("gives a new object for each call, so an edit does not leak", () => {
    claudeApprovalWarningEvent((info) => {
      info.utilization = 0.5;
    });

    expect(claudeApprovalWarningEvent().rate_limit_info).toMatchObject({ utilization: 0.95 });
  });
});

describe("withEventFirst", () => {
  it("puts the event line first and keeps the lines of the stream", () => {
    const event = claudeOverageEvent();
    const stream = claudeSample("plain");

    expect(withEventFirst(event, stream)).toEqual([JSON.stringify(event), ...stream]);
  });

  it("does not change the stream that it gets", () => {
    const stream = ["a", "b"];

    withEventFirst(claudeRateLimitEvent(), stream);

    expect(stream).toEqual(["a", "b"]);
  });
});

describe("withEventBeforeResult", () => {
  it("puts the event line before the last line and keeps the other lines", () => {
    const event = claudeApprovalWarningEvent();

    expect(withEventBeforeResult(event, ["a", "b", "c"])).toEqual(["a", "b", JSON.stringify(event), "c"]);
  });

  it("does not change the stream that it gets", () => {
    const stream = ["a", "b"];

    withEventBeforeResult(claudeRateLimitEvent(), stream);

    expect(stream).toEqual(["a", "b"]);
  });
});

describe("useFakeClaude controls untilStopped and sigtermStream", () => {
  it("keeps running after the output until a signal stops it", { timeout: 15_000 }, async () => {
    const fake = useFakeClaude({ stream: ["one"], untilStopped: true });
    const child = startClaude(fake.env);

    await waitUntil(() => child.stdout().includes("one\n"), 10_000, "the fake wrote no line");
    expect(isAlive(child.pid)).toBe(true);
    process.kill(child.pid, "SIGTERM");

    expect(await child.exited).toBe("SIGTERM");
  });

  it("writes its lines on SIGTERM and does not exit", { timeout: 15_000 }, async () => {
    const fake = useFakeClaude({ stream: ["one"], sigtermStream: ["two"], untilStopped: true });
    const child = startClaude(fake.env);

    await waitUntil(() => child.stdout().includes("one\n"), 10_000, "the fake wrote no line");
    process.kill(child.pid, "SIGTERM");
    await waitUntil(() => child.stdout().includes("two\n"), 10_000, "the fake wrote no sigtermStream line");
    expect(isAlive(child.pid)).toBe(true);
    process.kill(child.pid, "SIGKILL");

    expect(await child.exited).toBe("SIGKILL");
  });
});

describe("useFakeClaude", () => {
  it("plays back a sample on stdout and logs argv, stdin and env names", () => {
    const stream = claudeSample("plain");
    const fake = useFakeClaude({ stream });

    const result = runClaude(fake.env, ["-p", "--model", "opus"], "say hello");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${stream.join("\n")}\n`);
    const calls = fake.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0].argv).toEqual(["-p", "--model", "opus"]);
    expect(calls[0].stdin).toBe("say hello");
    expect(calls[0].envNames).toEqual(expect.arrayContaining(["HOME", "PATH"]));
  });

  it("gives [] before the fake runs, and one call for each run", () => {
    const fake = useFakeClaude({});
    expect(fake.calls()).toEqual([]);

    runClaude(fake.env, ["a"]);
    runClaude(fake.env, ["b"]);

    expect(fake.calls().map((call) => call.argv)).toEqual([["a"], ["b"]]);
  });

  it("writes stderr and exits with the exit code", () => {
    const fake = useFakeClaude({ stderr: "bad\n", exitCode: 3 });

    const result = runClaude(fake.env, ["-p"]);

    expect(result.status).toBe(3);
    expect(result.stderr).toBe("bad\n");
    expect(fake.calls()).toHaveLength(1);
  });

  it("answers --version from the version control, and not a run", () => {
    const fake = useFakeClaude({
      stream: claudeSample("plain"),
      version: { stdout: "2.1.299 (Claude Code)\n", exitCode: 0 },
    });

    const result = runClaude(fake.env, ["--version"]);

    expect(result.stdout).toBe("2.1.299 (Claude Code)\n");
    expect(result.status).toBe(0);
  });

  it("ends with the signal of killWith after the output", () => {
    const fake = useFakeClaude({ stream: ["{}"], killWith: "SIGKILL" });

    const result = runClaude(fake.env, ["-p"]);

    expect(result.signal).toBe("SIGKILL");
    expect(result.stdout).toBe("{}\n");
  });

  it("does not read a control name from the env", () => {
    const fake = useFakeClaude({ stream: ["{}"] });
    const env = childEnv(
      { ...fake.env, TASKER_FAKE_CLAUDE_EXIT: "9", FAKE_CLAUDE_EXIT: "9", ANTHROPIC_API_KEY: "k" },
      [],
    );

    const result = runClaude(env, ["-p"]);

    expect(result.status).toBe(0);
    const names = fake.calls()[0].envNames;
    expect(names).toEqual(expect.arrayContaining(["HOME", "PATH"]));
    expect(names).not.toContain("TASKER_FAKE_CLAUDE_EXIT");
    expect(names).not.toContain("FAKE_CLAUDE_EXIT");
    expect(names).not.toContain("ANTHROPIC_API_KEY");
  });
});

describe("useFakeClaude with turns and exec", () => {
  it("gives each call the fields of its own turn, and the top-level fields past the list", () => {
    const fake = useFakeClaude({
      stream: ["top"],
      turns: [{ stream: ["one"] }, { stream: ["two"], exitCode: 4, stderr: "bad\n" }],
    });

    const first = runClaude(fake.env, ["-p"]);
    const second = runClaude(fake.env, ["-p"]);
    const third = runClaude(fake.env, ["-p"]);

    expect(first.stdout).toBe("one\n");
    expect(first.status).toBe(0);
    expect(second.stdout).toBe("two\n");
    expect(second.status).toBe(4);
    expect(second.stderr).toBe("bad\n");
    expect(third.stdout).toBe("top\n");
    expect(third.status).toBe(0);
  });

  it("keeps the top-level field that a turn does not set", () => {
    const fake = useFakeClaude({ stream: ["top"], exitCode: 2, turns: [{ stderr: "x\n" }] });

    const result = runClaude(fake.env, ["-p"]);

    expect(result.stdout).toBe("top\n");
    expect(result.status).toBe(2);
    expect(result.stderr).toBe("x\n");
  });

  it("does not count a --version call", () => {
    const fake = useFakeClaude({
      stream: ["top"],
      version: { stdout: "2.1.299 (Claude Code)\n" },
      turns: [{ stream: ["one"] }],
    });

    runClaude(fake.env, ["--version"]);
    const result = runClaude(fake.env, ["-p"]);

    expect(result.stdout).toBe("one\n");
  });

  it("gives the same stream to each call when the control has no turns", () => {
    const fake = useFakeClaude({ stream: ["same"] });

    expect(runClaude(fake.env, ["-p"]).stdout).toBe("same\n");
    expect(runClaude(fake.env, ["-p"]).stdout).toBe("same\n");
  });

  it("runs exec in the cwd before the output", () => {
    const cwd = useTempDir("tasker-fake-cwd-");
    const fake = useFakeClaude({ stream: ["out"], turns: [{ exec: [realCommandPath("touch"), "made.txt"] }] });

    const result = spawnSync("claude", ["-p"], { env: fake.env, cwd, encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("out\n");
    expect(existsSync(join(cwd, "made.txt"))).toBe(true);
  });

  it("writes one stderr line and exits with 99 when exec fails", () => {
    const fake = useFakeClaude({ stream: ["out"], turns: [{ exec: [realCommandPath("false")] }] });

    const result = runClaude(fake.env, ["-p"]);

    expect(result.status).toBe(99);
    expect(result.stdout).toBe("");
    expect(result.stderr.trimEnd().split("\n")).toHaveLength(1);
  });
});

describe("useFakeClaude with settings and placeholders", () => {
  it("logs the parsed settings, and none when the call has no --settings", () => {
    const fake = useFakeClaude({});
    const settings = { sandbox: { enabled: true, filesystem: { allowWrite: ["/a"] } } };

    runClaude(fake.env, ["-p", "--settings", JSON.stringify(settings), "--model", "x"]);
    runClaude(fake.env, ["-p"]);

    const calls = fake.calls();
    expect(calls[0].settings).toEqual(settings);
    expect(calls[1]).not.toHaveProperty("settings");
  });

  it("makes the placeholders in its cwd before it is killed", () => {
    const fake = useFakeClaude({ placeholders: [".bashrc", ".claude/settings.json"], killWith: "SIGKILL" });
    const cwd = useTempDir("tasker-fake-cwd-");

    const result = spawnSync("claude", ["-p"], { env: fake.env, cwd, encoding: "utf8" });

    expect(result.signal).toBe("SIGKILL");
    for (const name of [".bashrc", ".claude/settings.json"]) {
      const stat = lstatSync(join(cwd, name));
      expect(stat.size).toBe(0);
      expect(stat.mode & 0o777).toBe(0o444);
    }
  });
});

describe("writePlaceholder", () => {
  it("makes the parent folders and an empty file with mode 0o444", () => {
    const root = useTempDir("tasker-placeholder-");

    writePlaceholder(root, ".claude/hooks");

    const stat = lstatSync(join(root, ".claude", "hooks"));
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(0);
    expect(stat.mode & 0o777).toBe(0o444);
  });
});

describe("argAfter", () => {
  it("gives the argument after the flag", () => {
    expect(argAfter(["-p", "--resume", "abc", "--x"], "--resume")).toBe("abc");
  });

  it("gives undefined when the flag is missing and nothing is at index 0", () => {
    expect(argAfter([], "--resume")).toBeUndefined();
  });
});

describe("useFakeClaudeOnPath", () => {
  it("puts the fake first on PATH and gives the process a new HOME", () => {
    const before = process.env.HOME;
    const fake = useFakeClaudeOnPath({ stream: ["one"] });

    expect(process.env.PATH?.startsWith(`${fake.binDir}${delimiter}`)).toBe(true);
    expect(process.env.HOME).not.toBe(before);
    expect(existsSync(process.env.HOME!)).toBe(true);
    expect(runClaude(process.env, []).stdout).toBe("one\n");
  });

  it("puts the fake bwrap and socat on PATH after the fake claude", () => {
    const fake = useFakeClaudeOnPath({});

    const dirs = process.env.PATH!.split(delimiter);
    expect(dirs[0]).toBe(fake.binDir);
    for (const name of ["bwrap", "socat"]) {
      expect(dirs.some((dir) => existsSync(join(dir, name)))).toBe(true);
    }
  });
});
