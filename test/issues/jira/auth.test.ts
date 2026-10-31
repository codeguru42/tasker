import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { authStatus } from "../../../src/issues/jira/auth.js";
import { failureOf } from "../../helpers/errors.js";
import {
  AUTH_STATUS_ARGS,
  AUTH_STATUS_CALLS,
  JIRA_LOGIN_MESSAGE,
  fakeAcli,
  MEASURED_AUTH_STATUS,
  MEASURED_NOT_FOUND,
} from "../../helpers/fake-acli.js";
import { useTempDir } from "../../helpers/temp.js";

const readStatus = (env: NodeJS.ProcessEnv, signal?: AbortSignal) => authStatus(env, { signal });

describe("authStatus", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-jira-auth-");
  });

  it("gives the active site as the login", async () => {
    const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS }]);

    expect(await readStatus(fake.env)).toStrictEqual({
      ok: true,
      login: "codeguru42.atlassian.net",
      detail: "acli uses the site codeguru42.atlassian.net",
      needsLogin: false,
    });
    expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
  });

  it("asks for a login when acli has none", async () => {
    const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stderr: MEASURED_NOT_FOUND, exitCode: 1 }]);

    expect(await readStatus(fake.env)).toStrictEqual({ ok: false, detail: JIRA_LOGIN_MESSAGE, needsLogin: true });
    expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
  });

  it("does not ask for a login when acli is not installed", async () => {
    const fake = fakeAcli(dir, {}, []);

    expect(await readStatus({ ...fake.env, TASKER_ACLI_BIN: "no-such-acli" })).toStrictEqual({
      ok: false,
      detail: "no-such-acli is not installed: install acli, or fix TASKER_ACLI_BIN",
      needsLogin: false,
    });
    expect(fake.calls()).toEqual([]);
  });

  it("does not ask for a login when TASKER_ACLI_BIN is bad", async () => {
    const fake = fakeAcli(dir, {}, []);
    const bad = join(dir, "missing");

    expect(await readStatus({ ...fake.env, TASKER_ACLI_BIN: bad })).toStrictEqual({
      ok: false,
      detail: `TASKER_ACLI_BIN is ${bad}, but ${bad} is not a file that you can run`,
      needsLogin: false,
    });
    expect(fake.calls()).toEqual([]);
  });

  it("rejects with AbortError when the signal aborts", async () => {
    const fake = fakeAcli(dir, {}, [{ args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS, delaySeconds: 5 }]);
    const start = Date.now();

    const error = await failureOf(readStatus(fake.env, AbortSignal.timeout(100)), Error);

    expect(error.name).toBe("AbortError");
    expect(Date.now() - start).toBeLessThan(2000);
    expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
  });
});
