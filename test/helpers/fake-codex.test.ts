import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODEX_LOGIN_STATUS_ARGS,
  CODEX_VERSION_ARGS,
  codexSample,
  CODEX_PLAIN_USAGE,
  CODEX_RESUME_USAGE,
  CODEX_THREAD_ID,
  codexSampleEvents,
  expectedCodexArgs,
  MEASURED_LOGGED_OUT,
  useFakeCodex,
  useFakeCodexRun,
} from "./fake-codex.js";

function runCodex(env: NodeJS.ProcessEnv, args: readonly string[]) {
  return spawnSync(join(env.PATH ?? "", "codex"), [...args], { env, encoding: "utf8" });
}

describe("useFakeCodex", () => {
  it("gives the stdout, stderr and exit code of the answer", () => {
    const fake = useFakeCodex([
      { args: CODEX_VERSION_ARGS, stdout: "codex-cli 0.166.0\n" },
      { args: CODEX_LOGIN_STATUS_ARGS, ...MEASURED_LOGGED_OUT },
    ]);

    const version = runCodex(fake.env, CODEX_VERSION_ARGS);
    const login = runCodex(fake.env, CODEX_LOGIN_STATUS_ARGS);

    expect([version.stdout, version.stderr, version.status]).toEqual(["codex-cli 0.166.0\n", "", 0]);
    expect([login.stdout, login.stderr, login.status]).toEqual(["", "Not logged in\n", 1]);
  });

  it("logs each call", () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS }, { args: CODEX_LOGIN_STATUS_ARGS }]);

    runCodex(fake.env, CODEX_VERSION_ARGS);
    runCodex(fake.env, CODEX_LOGIN_STATUS_ARGS);

    expect(fake.calls()).toEqual([
      { args: ["--version"], env: {} },
      { args: ["login", "status"], env: {} },
    ]);
  });

  it("logs the env names of logEnv", () => {
    const fake = useFakeCodex([{ args: CODEX_VERSION_ARGS }], ["CODEX_HOME", "SECRET"]);

    runCodex({ ...fake.env, CODEX_HOME: "/codex" }, CODEX_VERSION_ARGS);

    expect(fake.calls()).toEqual([{ args: ["--version"], env: { CODEX_HOME: "/codex", SECRET: undefined } }]);
  });

  it("has the bin folder as the only PATH folder", () => {
    const fake = useFakeCodex([]);

    expect(fake.env.PATH.endsWith("/bin")).toBe(true);
    expect(fake.env.PATH).not.toContain(":");
  });
});

describe("useFakeCodexRun", () => {
  it("plays plain.jsonl under the name codex and logs argv and stdin", () => {
    const fake = useFakeCodexRun({ stream: codexSample("plain") });

    const run = spawnSync(join(fake.binDir, "codex"), ["exec", "--json", "-"], {
      env: fake.env,
      input: "say hello",
      encoding: "utf8",
    });

    expect(run.status).toBe(0);
    expect(run.stdout.split("\n").filter((line) => line !== "")).toEqual(codexSample("plain"));
    expect(fake.calls().map((call) => [call.argv, call.stdin])).toEqual([[["exec", "--json", "-"], "say hello"]]);
  });
});

describe("codexSampleEvents", () => {
  it("parses each line of the sample", () => {
    const events = codexSampleEvents("plain");

    expect(events.map((event) => event.type)).toEqual([
      "thread.started",
      "turn.started",
      "item.completed",
      "turn.completed",
    ]);
    expect(events[0].thread_id).toBe(CODEX_THREAD_ID);
  });

  it("gives new objects for each call", () => {
    expect(codexSampleEvents("plain")[0]).not.toBe(codexSampleEvents("plain")[0]);
  });
});

describe("CODEX_THREAD_ID", () => {
  it.each(["plain", "resume"])("is the thread id of %s.jsonl", (name) => {
    const started = codexSampleEvents(name).find((event) => event.type === "thread.started");

    expect(started?.thread_id).toBe(CODEX_THREAD_ID);
  });
});

describe("expectedCodexArgs", () => {
  it("adds the host Docker socket to the deny table when it resolves", () => {
    let docker: string | undefined;
    try {
      docker = realpathSync("/var/run/docker.sock");
    } catch {
      /* The host has no Docker socket. */
    }
    const args = expectedCodexArgs({ model: "m", effort: "low" });
    const table = args.find((arg) => arg.startsWith("permissions.tasker.filesystem="));
    expect(table).toBe(
      `permissions.tasker.filesystem={"/"="read"${docker === undefined ? "" : `, ${JSON.stringify(docker)}="deny"`}}`,
    );
  });

  it("gives the whole list of a continued session with a schema and two denied paths", () => {
    expect(
      expectedCodexArgs({
        model: "gpt-x",
        effort: "high",
        denyRead: ["/h/.ssh", "/h/.ssh", "/h/a b"],
        threadId: "T1",
        schemaPath: "/s/id.schema.json",
      }),
    ).toEqual([
      "exec",
      "resume",
      "--json",
      "--ignore-user-config",
      "--ignore-rules",
      "-m",
      "gpt-x",
      "-c",
      'model_reasoning_effort="high"',
      "-c",
      'approval_policy="never"',
      "-c",
      'web_search="disabled"',
      "-c",
      "features.apps=false",
      "-c",
      'default_permissions="tasker"',
      "-c",
      'permissions.tasker.filesystem={"/"="read", "/h/.ssh"="deny", "/h/a b"="deny"}',
      "-c",
      "permissions.tasker.network.enabled=true",
      "--output-schema",
      "/s/id.schema.json",
      "T1",
      "-",
    ]);
  });
});

describe("the usage constants", () => {
  it("add up to the raw totals of resume.jsonl", () => {
    const raw = codexSampleEvents("resume")[3].usage as Record<string, number>;

    expect(
      CODEX_RESUME_USAGE.inputTokens +
        CODEX_PLAIN_USAGE.inputTokens +
        CODEX_RESUME_USAGE.cacheReadInputTokens +
        CODEX_PLAIN_USAGE.cacheReadInputTokens,
    ).toBe(raw.input_tokens);
    expect(CODEX_PLAIN_USAGE.cacheReadInputTokens + CODEX_RESUME_USAGE.cacheReadInputTokens).toBe(
      raw.cached_input_tokens,
    );
    expect(CODEX_RESUME_USAGE.outputTokens + CODEX_PLAIN_USAGE.outputTokens).toBe(raw.output_tokens);
  });
});

describe("expectedCodexArgs", () => {
  it("writes the write keys before the deny keys, and the hook arguments after the network line", () => {
    expect(
      expectedCodexArgs({
        model: "m",
        effort: "low",
        writePaths: ["/w", "/p"],
        denyRead: ["/p", "/d"],
        hookCommand: "node 'h.js'",
        threadId: "T1",
      }),
    ).toEqual([
      "exec",
      "resume",
      "--json",
      "--ignore-user-config",
      "--ignore-rules",
      "-m",
      "m",
      "-c",
      'model_reasoning_effort="low"',
      "-c",
      'approval_policy="never"',
      "-c",
      'web_search="disabled"',
      "-c",
      "features.apps=false",
      "-c",
      'default_permissions="tasker"',
      "-c",
      'permissions.tasker.filesystem={"/"="read", "/w"="write", "/p"="deny", "/d"="deny"}',
      "-c",
      "permissions.tasker.network.enabled=true",
      "-c",
      'hooks.PreToolUse=[{matcher="^apply_patch$", hooks=[{type="command", command="node \'h.js\'", timeout=10}]}]',
      "--dangerously-bypass-hook-trust",
      "T1",
      "-",
    ]);
  });
});
