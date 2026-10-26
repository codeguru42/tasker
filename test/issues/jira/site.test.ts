import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AcliBinError, AcliNotInstalledError } from "../../../src/issues/jira/run.js";
import { activeSite, JiraLoginError, JiraSiteError, siteGuard } from "../../../src/issues/jira/site.js";
import { failureOf } from "../../helpers/errors.js";
import { fakeAcli } from "../../helpers/fake-acli.js";
import { useTempDir } from "../../helpers/temp.js";

const KELVIN = String.fromCodePoint(0x212a);
const status = ["jira", "auth", "status"];
const statusCalls = [{ args: status, env: {} }];
const measured = [
  "✓ Authenticated",
  "  Site: codeguru42.atlassian.net",
  "  Email: user@example.com",
  "  Authentication Type: oauth_global",
  "",
].join("\n");
const loginMessage = "acli has no Jira login. Run `acli jira auth login`.";

const readSite = (env: NodeJS.ProcessEnv, signal?: AbortSignal) => activeSite(env, { signal });
const guard = (site: string | undefined, env: NodeJS.ProcessEnv, signal?: AbortSignal) =>
  siteGuard("work", site, env, { signal });

describe("site", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-jira-site-");
  });

  describe("activeSite", () => {
    it("reads the site of the measured output", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: measured }]);

      expect(await readSite(fake.env)).toBe("codeguru42.atlassian.net");
      expect(fake.calls()).toEqual(statusCalls);
    });

    it("removes the white space around the value", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: "  Site:   foo.atlassian.net  \n" }]);

      expect(await readSite(fake.env)).toBe("foo.atlassian.net");
    });

    it("folds the value to lower case", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: "Site: CODEGURU42.ATLASSIAN.NET\n" }]);

      expect(await readSite(fake.env)).toBe("codeguru42.atlassian.net");
    });

    it("reads lines that end with CRLF", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: measured.replaceAll("\n", "\r\n") }]);

      expect(await readSite(fake.env)).toBe("codeguru42.atlassian.net");
    });

    it("keeps the Kelvin sign as it is", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: `Site: ${KELVIN}elvin.atlassian.net\n` }]);

      expect(await readSite(fake.env)).toBe(`${KELVIN}elvin.atlassian.net`);
    });

    it("takes the first Site line", async () => {
      const fake = fakeAcli(dir, {}, [
        { args: status, stdout: "Site: first.atlassian.net\nSite: second.atlassian.net\n" },
      ]);

      expect(await readSite(fake.env)).toBe("first.atlassian.net");
    });

    it("does not count a line with site in lower case", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: "site: x\n" }]);

      await failureOf(readSite(fake.env), JiraLoginError);
      expect(fake.calls()).toEqual(statusCalls);
    });

    it("rejects with JiraLoginError when no Site line exists", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: "✓ Authenticated\n" }]);

      const error = await failureOf(readSite(fake.env), JiraLoginError);

      expect(error.message).toBe(loginMessage);
      expect(fake.calls()).toEqual(statusCalls);
    });

    it("rejects with JiraLoginError when the value is empty", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: "  Site:   \n" }]);

      await failureOf(readSite(fake.env), JiraLoginError);
      expect(fake.calls()).toEqual(statusCalls);
    });

    it("rejects with JiraLoginError for a non-zero exit", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, exitCode: 1, stderr: "✗ Error: not logged in" }]);

      const error = await failureOf(readSite(fake.env), JiraLoginError);

      expect(error.message).toBe(loginMessage);
      expect(fake.calls()).toEqual(statusCalls);
    });

    it("rejects with AcliNotInstalledError when acli is missing", async () => {
      const fake = fakeAcli(dir, {}, []);

      await failureOf(readSite({ ...fake.env, TASKER_ACLI_BIN: "no-such-acli" }), AcliNotInstalledError);
      expect(fake.calls()).toEqual([]);
    });

    it("rejects with AcliBinError for a bad TASKER_ACLI_BIN", async () => {
      const fake = fakeAcli(dir, {}, []);

      await failureOf(readSite({ ...fake.env, TASKER_ACLI_BIN: join(dir, "missing") }), AcliBinError);
      expect(fake.calls()).toEqual([]);
    });

    it("rejects with AbortError when the signal aborts", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: measured, delaySeconds: 5 }]);
      const start = Date.now();

      const error = await failureOf(readSite(fake.env, AbortSignal.timeout(100)), Error);

      expect(error.name).toBe("AbortError");
      expect(Date.now() - start).toBeLessThan(2000);
    });
  });

  describe("siteGuard", () => {
    it("returns the active site when the repo has no site", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: measured }]);

      expect(await guard(undefined, fake.env)).toBe("codeguru42.atlassian.net");
    });

    it("accepts the same site in another case and with white space", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: measured }]);

      expect(await guard("  CodeGuru42.Atlassian.NET ", fake.env)).toBe("codeguru42.atlassian.net");
    });

    it("fails with JiraSiteError for another site", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: measured }]);

      const error = await failureOf(guard("Other.atlassian.net", fake.env), JiraSiteError);

      expect(error.message).toBe(
        "Jira repo 'work' names the site other.atlassian.net, but acli uses codeguru42.atlassian.net. Switch acli with `acli jira auth switch --site other.atlassian.net`, then run the command again.",
      );
      expect(fake.calls()).toEqual(statusCalls);
    });

    it("keeps the Kelvin sign of the active site as it is", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: `Site: ${KELVIN}elvin.atlassian.net\n` }]);

      await failureOf(guard("kelvin.atlassian.net", fake.env), JiraSiteError);
      expect(fake.calls()).toEqual(statusCalls);
    });

    it("reads the active site on each call", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: measured }]);

      await guard("codeguru42.atlassian.net", fake.env);
      fakeAcli(dir, {}, [{ args: status, stdout: "Site: other.atlassian.net\n" }]);
      await failureOf(guard("codeguru42.atlassian.net", fake.env), JiraSiteError);

      expect(fake.calls()).toHaveLength(2);
    });

    it("passes a login error through", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: "✓ Authenticated\n" }]);

      await failureOf(guard("a.atlassian.net", fake.env), JiraLoginError);
      expect(fake.calls()).toEqual(statusCalls);
    });

    it("rejects with AbortError when the signal aborts", async () => {
      const fake = fakeAcli(dir, {}, [{ args: status, stdout: measured, delaySeconds: 5 }]);

      const error = await failureOf(guard(undefined, fake.env, AbortSignal.timeout(100)), Error);

      expect(error.name).toBe("AbortError");
    });
  });

  it.each([
    [new JiraLoginError(), "JiraLoginError"],
    [new JiraSiteError("k", "a", "b"), "JiraSiteError"],
  ])("names the error %s", (error, name) => {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
  });
});
