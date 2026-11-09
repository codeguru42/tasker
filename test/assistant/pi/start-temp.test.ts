import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunOutcome } from "../../../src/assistant/provider.js";
import { useTempDir } from "../../helpers/temp.js";
import { describe, expect, it, vi } from "vitest";

interface StartTempResult {
  runWithStartTemp(
    env: NodeJS.ProcessEnv,
    start: (tempFolder: string, markSpawned: () => void) => Promise<RunOutcome>,
    failure: (error: unknown) => Extract<RunOutcome, { kind: "failure" }>,
    removeTempFolder?: (tempFolder: string) => void,
  ): Promise<RunOutcome>;
}

async function startTemp(): Promise<StartTempResult> {
  const path = resolve(process.cwd(), "src/assistant/pi/start-temp.js");
  return (await import(path)) as StartTempResult;
}

function outcome(kind: RunOutcome["kind"]): RunOutcome {
  const base = { sessionId: "session", events: [], permissionDenials: [], usage: "unavailable" as const };
  switch (kind) {
    case "success":
      return { ...base, kind };
    case "failure":
      return { ...base, kind, exitCode: 1, signal: null, reason: "start failed" };
    case "timeout":
      return { ...base, kind };
    case "quota":
      return { ...base, kind, cause: "rate_limit" };
    case "interrupted":
      return { ...base, kind, signal: "SIGINT" };
  }
}

function failure(error: unknown): Extract<RunOutcome, { kind: "failure" }> {
  return {
    kind: "failure",
    sessionId: "session",
    events: [],
    permissionDenials: [],
    usage: "unavailable",
    exitCode: 1,
    signal: null,
    reason: error instanceof Error ? error.message : String(error),
  };
}

describe("runWithStartTemp", () => {
  it("creates no folder when a refusal occurs before the helper runs", async () => {
    const root = useTempDir("tasker-pi-start-refused-");
    const before = readdirSync(root);
    const start = vi.fn();

    const refused = outcome("failure");
    expect(refused.kind).toBe("failure");
    expect(start).not.toHaveBeenCalled();
    expect(readdirSync(root)).toEqual(before);
  });

  it("creates a writable folder under TMPDIR for the callback", async () => {
    const root = useTempDir("tasker-pi-start-running-");
    let tempFolder = "";
    let writable = false;
    const helper = await startTemp();

    await helper.runWithStartTemp(
      { TMPDIR: root },
      async (folder, markSpawned) => {
        tempFolder = folder;
        writeFileSync(join(folder, "marker"), "writable");
        writable = readFileSync(join(folder, "marker"), "utf8") === "writable";
        markSpawned();
        return outcome("success");
      },
      failure,
    );

    expect(tempFolder).toMatch(/^.*tasker-pi-/);
    expect(writable).toBe(true);
  });

  it("removes the folder and its content after the process group ends without following links", async () => {
    const root = useTempDir("tasker-pi-start-clean-");
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "keep"), "safe");
    let tempFolder = "";
    const helper = await startTemp();

    const result = await helper.runWithStartTemp(
      { TMPDIR: root },
      async (folder, markSpawned) => {
        tempFolder = folder;
        writeFileSync(join(folder, "inside"), "remove");
        symlinkSync(outside, join(folder, "link"));
        markSpawned();
        return outcome("success");
      },
      failure,
    );

    expect(result.kind).toBe("success");
    expect(existsSync(tempFolder)).toBe(false);
    expect(readFileSync(join(outside, "keep"), "utf8")).toBe("safe");
  });

  it.each(["precheck", "limits write", "spawn"] as const)(
    "cleans up after a %s failure before spawn",
    async (stage) => {
      const root = useTempDir(`tasker-pi-start-${stage.replaceAll(" ", "-")}-`);
      let tempFolder = "";
      const helper = await startTemp();

      const result = await helper.runWithStartTemp(
        { TMPDIR: root },
        async (folder) => {
          tempFolder = folder;
          return failure(new Error(`${stage} failed`));
        },
        failure,
      );

      expect(result.kind).toBe("failure");
      expect(existsSync(tempFolder)).toBe(false);
    },
  );

  it("reports only the cleanup error code after a pre-spawn failure", async () => {
    const root = useTempDir("tasker-pi-start-remove-fails-");
    const helper = await startTemp();
    const result = await helper.runWithStartTemp(
      { TMPDIR: root },
      async (folder) => {
        expect(existsSync(folder)).toBe(true);
        return failure(new Error("spawn failed"));
      },
      failure,
      () => {
        throw Object.assign(new Error("secret path"), { code: "EACCES" });
      },
    );

    expect(result.kind).toBe("failure");
    if (result.kind === "failure") {
      expect(result.reason).toContain("EACCES");
      expect(result.reason).not.toContain(root);
      expect(result.reason).not.toContain("secret path");
    }
  });

  it.each(["success", "failure", "timeout", "quota", "interrupted"] as const)(
    "removes the folder after a spawned %s outcome",
    async (kind) => {
      const root = useTempDir(`tasker-pi-start-${kind}-`);
      let tempFolder = "";
      const helper = await startTemp();
      const result = await helper.runWithStartTemp(
        { TMPDIR: root },
        async (folder, markSpawned) => {
          tempFolder = folder;
          markSpawned();
          return outcome(kind);
        },
        failure,
      );

      expect(result.kind).toBe(kind);
      expect(existsSync(tempFolder)).toBe(false);
      expect(result).not.toHaveProperty("sandboxCleanup");
    },
  );

  it.each(["success", "failure", "timeout", "quota", "interrupted"] as const)(
    "keeps a spawned %s outcome and reports a path-free cleanup error",
    async (kind) => {
      const root = useTempDir(`tasker-pi-start-${kind}-remove-fails-`);
      const helper = await startTemp();
      const result = await helper.runWithStartTemp(
        { TMPDIR: root },
        async (folder, markSpawned) => {
          markSpawned();
          return outcome(kind);
        },
        failure,
        () => {
          throw Object.assign(new Error("secret path"), { code: "EIO" });
        },
      );

      expect(result.kind).toBe(kind);
      expect(result).toHaveProperty("sandboxCleanup.error");
      expect(JSON.stringify(result)).toContain("EIO");
      expect(JSON.stringify(result)).not.toContain(root);
      expect(JSON.stringify(result)).not.toContain("secret path");
    },
  );
});
