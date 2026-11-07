import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { useFakePi } from "./fake-pi.js";

function runPi(env: NodeJS.ProcessEnv, args: readonly string[]) {
  return spawnSync(env.TASKER_PI_BIN ?? "pi", [...args], { env, encoding: "utf8" });
}

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

    expect(fake.calls()).toEqual([{ args: ["auth", "check"], env: { PI_CODING_AGENT_DIR: "/home/user/.pi/agent" } }]);
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
