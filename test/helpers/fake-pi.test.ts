import { readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { useFakePi } from "./fake-pi.js";
import { useTempDir } from "./temp.js";

function runPi(env: NodeJS.ProcessEnv, args: readonly string[], input = "", cwd?: string) {
  return spawnSync(env.TASKER_PI_BIN ?? "pi", [...args], { env, input, encoding: "utf8", cwd });
}

const measures = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/pi-streams/measures.json", import.meta.url)), "utf8"),
) as Record<string, { stdout: unknown[]; session: unknown[] }>;

describe("useFakePi", () => {
  it("gives the configured output and exit code", () => {
    const fake = useFakePi([{ args: ["--version"], stdout: "pi 1.1.0\n", stderr: "note\n", exitCode: 4 }]);

    const result = runPi(fake.env, ["--version"]);

    expect([result.stdout, result.stderr, result.status]).toEqual(["pi 1.1.0\n", "note\n", 4]);
  });

  it("waits for the configured delay", () => {
    const fake = useFakePi([{ args: ["slow"], stdout: "done", delaySeconds: 0.1 }]);
    const startedAt = Date.now();

    const result = runPi(fake.env, ["slow"]);

    expect(result.stdout).toBe("done");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(75);
  });

  it("stops with the configured signal", () => {
    const fake = useFakePi([{ args: ["stop"], killWith: "TERM" }]);

    const result = runPi(fake.env, ["stop"]);

    expect([result.status, result.signal]).toEqual([null, "SIGTERM"]);
  });

  it("logs the arguments and PI_CODING_AGENT_DIR", () => {
    const fake = useFakePi([{ args: ["auth", "check"] }], ["PI_CODING_AGENT_DIR"]);

    runPi({ ...fake.env, PI_CODING_AGENT_DIR: "/home/user/.pi/agent" }, ["auth", "check"]);

    expect(fake.calls()).toEqual([
      {
        args: ["auth", "check"],
        stdin: "",
        envNames: expect.arrayContaining(["PI_CODING_AGENT_DIR"]),
        env: { PI_CODING_AGENT_DIR: "/home/user/.pi/agent" },
      },
    ]);
  });

  it("plays each measured stream and logs the full stdin and environment names", () => {
    const dir = useTempDir("tasker-pi-measured-session-");
    const fake = useFakePi(
      [
        {
          args: ["--session-id", "one", "--session-dir", dir],
          stream: measures.text.stdout,
          session: measures.text.session,
        },
        {
          args: ["--session-id", "two", "--session-dir", dir],
          stream: measures.valid.stdout,
          session: measures.valid.session,
        },
      ] as never,
      ["PI_CODING_AGENT_DIR"],
    );

    const first = runPi(
      { ...fake.env, PI_CODING_AGENT_DIR: "/tmp/agent" },
      ["--session-id", "one", "--session-dir", dir],
      "  first prompt\n",
    );
    const second = runPi(
      { ...fake.env, PI_CODING_AGENT_DIR: "/tmp/agent" },
      ["--session-id", "two", "--session-dir", dir],
      "second prompt\nmore input",
    );

    expect(
      first.stdout
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual(measures.text.stdout);
    expect(
      second.stdout
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual(measures.valid.stdout);
    const calls = fake.calls() as {
      args: string[];
      stdin: string;
      envNames: string[];
      env: Record<string, string | undefined>;
    }[];
    expect(calls.map(({ args, stdin, envNames }) => ({ args, stdin, envNames }))).toEqual([
      {
        args: ["--session-id", "one", "--session-dir", dir],
        stdin: "  first prompt\n",
        envNames: expect.arrayContaining(["PI_CODING_AGENT_DIR"]),
      },
      {
        args: ["--session-id", "two", "--session-dir", dir],
        stdin: "second prompt\nmore input",
        envNames: expect.arrayContaining(["PI_CODING_AGENT_DIR"]),
      },
    ]);
    expect(readdirSync(dir).sort()).toEqual([
      "2026-11-08T02-20-34-100Z_one.jsonl",
      "2026-11-08T02-21-45-167Z_two.jsonl",
    ]);
    expect(readFileSync(join(dir, "2026-11-08T02-20-34-100Z_one.jsonl"), "utf8")).toContain('"type":"session"');
    expect(readFileSync(join(dir, "2026-11-08T02-21-45-167Z_two.jsonl"), "utf8")).toContain('"type":"session"');
  });

  it.each(["--session-id", "--session"])("refuses %s without a session directory", (flag) => {
    const cwd = useTempDir("tasker-pi-no-session-dir-");
    const fake = useFakePi([{ args: [flag, "missing"] }] as never);

    const result = runPi(fake.env, [flag, "missing"], "", cwd);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("fake pi: --session-dir is required\n");
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("creates and continues a measured session file", () => {
    const dir = useTempDir("tasker-pi-session-");
    const fake = useFakePi([
      {
        args: ["--session-id", "s1", "--session-dir", dir],
        stream: measures.text.stdout,
        session: measures.text.session,
      },
      {
        args: ["--session", "s1", "--session-dir", dir],
        stream: measures.valid.stdout,
        session: measures.valid.session,
      },
    ] as never);

    runPi(fake.env, ["--session-id", "s1", "--session-dir", dir]);
    const sessionFile = join(dir, "2026-11-08T02-20-34-100Z_s1.jsonl");
    const initial = readFileSync(sessionFile, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    runPi(fake.env, ["--session", "s1", "--session-dir", dir]);

    const continued = readFileSync(sessionFile, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(initial).toEqual(measures.text.session);
    expect(continued).toEqual([...measures.text.session, ...measures.valid.session.slice(1)]);
  });

  it("refuses a missing session before writing a session file", () => {
    const dir = useTempDir("tasker-pi-missing-session-");
    const fake = useFakePi([{ args: ["--session", "missing", "--session-dir", dir] }] as never);

    const result = runPi(fake.env, ["--session", "missing", "--session-dir", dir]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No session found matching 'missing'");
    expect(() => readFileSync(join(dir, "missing"), "utf8")).toThrow();
  });

  it("reports a call with no configured answer", () => {
    const fake = useFakePi([{ args: ["known"] }]);

    const result = runPi(fake.env, ["unknown"]);

    expect(result.status).toBe(99);
    expect(result.stderr).toBe("fake pi: no answer for: unknown\n");
    expect(fake.unanswered()).toEqual([["unknown"]]);
    rmSync(`${fake.logPath}.unanswered`);
  });
});
