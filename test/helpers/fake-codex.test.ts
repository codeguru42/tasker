import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CODEX_LOGIN_STATUS_ARGS,
  CODEX_VERSION_ARGS,
  codexSample,
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
    expect(events[0].thread_id).toBe("01a194bc-1d2f-77b2-a52d-5be299f7ea30");
  });

  it("gives new objects for each call", () => {
    expect(codexSampleEvents("plain")[0]).not.toBe(codexSampleEvents("plain")[0]);
  });
});

describe("expectedCodexArgs", () => {
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
