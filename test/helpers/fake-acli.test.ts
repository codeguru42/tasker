import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  acliWriteResult,
  AUTH_STATUS_ARGS,
  fakeAcli,
  fakeAcliView,
  jiraRefOf,
  MEASURED_AUTH_STATUS,
  MEASURED_NOT_FOUND,
  writeFakeAcli,
} from "./fake-acli.js";
import { useTempDir } from "./temp.js";

describe("fakeAcli", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-fake-acli-");
  });

  const run = (env: NodeJS.ProcessEnv, ...args: string[]) =>
    spawnSync(env.TASKER_ACLI_BIN ?? "acli", args, { env, encoding: "utf8" });

  it("answers a listed call with the stdout, stderr and exit code of its answer", () => {
    const fake = fakeAcli(dir, {}, [
      { args: ["jira", "workitem", "view", "TEST-1"], stdout: "out\n", stderr: "err\n", exitCode: 3 },
    ]);

    const result = run(fake.env, "jira", "workitem", "view", "TEST-1");

    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
    expect(result.status).toBe(3);
  });

  it("sets TASKER_ACLI_BIN to the fake and PATH to its folder", () => {
    const fake = fakeAcli(dir, { FOO: "bar" }, []);

    expect(fake.env.TASKER_ACLI_BIN).toBe(join(dir, "bin", "acli"));
    expect(fake.env.PATH).toBe(join(dir, "bin"));
    expect(fake.env.FOO).toBe("bar");
  });

  it("logs each call with its arguments and the values of logEnv", () => {
    const fake = fakeAcli(dir, { FOO: "bar" }, [{ args: ["a", "b"] }], { logEnv: ["FOO", "NOT_SET"] });

    run(fake.env, "a", "b");

    expect(fake.calls()).toEqual([{ args: ["a", "b"], env: { FOO: "bar", NOT_SET: undefined } }]);
  });

  it("exits with 99 for a call with no answer and logs it", () => {
    const fake = fakeAcli(dir, {}, [{ args: ["a"] }]);

    expect(run(fake.env, "b").status).toBe(99);
    expect(fake.unanswered()).toEqual([["b"]]);
    // Clear the log, so that the check of fakeAcli() at the end of the test passes.
    rmSync(`${fake.logPath}.unanswered`);
  });

  it("writes the fake under another name", () => {
    const binDir = join(dir, "other-bin");

    writeFakeAcli(binDir, join(dir, "other.log"), [{ args: [], stdout: "hi" }], [], "other");

    expect(spawnSync(join(binDir, "other"), [], { encoding: "utf8" }).stdout).toBe("hi");
  });
});

describe("jiraRefOf", () => {
  it("gives the ref of a Jira issue in the repo work", () => {
    expect(jiraRefOf("TEST-2")).toEqual({ key: "TEST-2", repoKey: "work", shortRef: "TEST-2" });
  });
});

describe("MEASURED_NOT_FOUND", () => {
  it("is the stderr of a view of an issue that does not exist", () => {
    expect(MEASURED_NOT_FOUND).toBe("✗ Error: Issue does not exist or you do not have permission to see it.");
  });
});

describe("fakeAcliView", () => {
  it("answers the auth status, then the view call", () => {
    const dir = useTempDir("tasker-fake-acli-view-");
    const viewArgs = ["jira", "workitem", "view", "TEST-2", "--json", "--fields", "summary"];
    const fake = fakeAcliView(dir, viewArgs, { stdout: "view out\n", exitCode: 2 });
    const run = (...args: string[]) =>
      spawnSync(fake.env.TASKER_ACLI_BIN ?? "acli", args, { env: fake.env, encoding: "utf8" });

    expect(run(...AUTH_STATUS_ARGS).stdout).toBe(MEASURED_AUTH_STATUS);
    const view = run(...viewArgs);
    expect(view.stdout).toBe("view out\n");
    expect(view.status).toBe(2);
    expect(fake.calls().map((call) => call.args)).toEqual([AUTH_STATUS_ARGS, viewArgs]);
  });
});

describe("acliWriteResult", () => {
  it("gives the measured form of a passed write", () => {
    expect(acliWriteResult("SUCCESS", "Work item TEST-10 has been successfully transitioned to In Progress")).toBe(
      '{"results":[{"status":"SUCCESS","message":"Work item TEST-10 has been successfully transitioned to In Progress","id":"TEST-10"}],"totalCount":1,"successCount":1}',
    );
  });

  it("gives the measured form of a refused write", () => {
    expect(acliWriteResult("FAILURE", "No allowed transitions found for given status")).toBe(
      '{"results":[{"status":"FAILURE","message":"No allowed transitions found for given status","id":"TEST-10"}],"totalCount":1,"successCount":0}',
    );
  });
});
