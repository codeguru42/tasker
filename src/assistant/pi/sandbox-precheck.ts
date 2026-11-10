import { realpathSync, statSync } from "node:fs";
import { errnoCode } from "../../errno.js";
import { findOnPath } from "../../process/resolve-program.js";
import type { RunInput, RunOutcome } from "../provider.js";
import { runWithStartTemp } from "./start-temp.js";
import { sandboxArgs } from "./sandbox-args.js";
import type { PiSandboxLimits } from "./guard-limits.js";
import { sandboxPart } from "./sandbox-part.js";
import { spawnPiBwrap } from "../../process/pi-bwrap.js";

const PROBE_TIMEOUT_MS = 10_000;

export interface SandboxPrecheckOptions {
  probeTimeoutMs?: number;
}

export async function runSandboxPrecheck(
  input: RunInput,
  start: (sandbox: PiSandboxLimits, markSpawned: () => void) => Promise<RunOutcome>,
  options: SandboxPrecheckOptions = {},
): Promise<RunOutcome> {
  const bwrap = findOnPath("bwrap", input.env);
  if (bwrap === undefined) return failed(input, "sandbox precheck failed: bwrap is not on PATH");

  const dbusIssue = validateDbusAddress(input.env.DBUS_SESSION_BUS_ADDRESS);
  if (dbusIssue !== undefined) return failed(input, dbusIssue);

  let worktree: string;
  try {
    worktree = realpathSync.native(input.cwd);
    if (!statSync(worktree).isDirectory()) throw pathError("ENOTDIR");
    for (const path of input.sandbox?.allowWrite ?? []) realpathSync.native(path);
  } catch (error) {
    return failed(input, `sandbox path precheck failed: ${errnoCode(error) ?? "unknown"}`);
  }

  return runWithStartTemp(
    input.env,
    async (tempFolder, markSpawned) => {
      let sandbox: PiSandboxLimits;
      try {
        sandbox = sandboxPart(input, bwrap, tempFolder);
      } catch (error) {
        return failed(input, `sandbox path precheck failed: ${errnoCode(error) ?? "unknown"}`);
      }

      const hideValidation = sandboxArgs({ sandbox, cwd: worktree, command: "true", env: input.env });
      if ("reason" in hideValidation) return failed(input, hideValidation.reason);

      const probeEnvForArgs = {
        ...input.env,
        SSH_AUTH_SOCK: undefined,
        DBUS_SESSION_BUS_ADDRESS: undefined,
      };
      const probe = sandboxArgs({
        sandbox: { ...sandbox, hidePaths: [] },
        cwd: worktree,
        command: "true",
        env: probeEnvForArgs,
      });
      if ("reason" in probe) return failed(input, probe.reason);

      let stderr = "";
      let exitCode: number;
      try {
        exitCode = await spawnPiBwrap(bwrap, probe.args, {
          cwd: worktree,
          env: input.env,
          onData: (chunk) => {
            stderr += chunk.toString();
          },
          timeout: options.probeTimeoutMs ?? PROBE_TIMEOUT_MS,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "sandbox probe failed";
        return failed(input, `sandbox probe failed: ${message}`);
      }
      if (exitCode !== 0) {
        const firstLine = stderr.split(/\r?\n/, 1)[0]?.trim();
        return failed(input, `sandbox probe failed with exit code ${exitCode}${firstLine ? `: ${firstLine}` : ""}`);
      }
      return start(sandbox, markSpawned);
    },
    (error) => failed(input, `sandbox temp folder failed: ${errnoCode(error) ?? "unknown"}`),
  );
}

function validateDbusAddress(addresses: string | undefined): string | undefined {
  if (addresses === undefined || addresses.trim() === "") return undefined;
  for (const address of addresses.split(";")) {
    const separator = address.indexOf(":");
    const transport = separator < 0 ? address : address.slice(0, separator);
    const fields = separator < 0 ? [] : address.slice(separator + 1).split(",");
    const firstKey = fields[0]?.split("=", 1)[0] || "missing";
    if (transport !== "unix") {
      return `unsupported D-Bus address: transport ${transport || "unknown"}, key ${firstKey}`;
    }
    if (!fields.some((field) => field.split("=", 1)[0] === "path")) {
      return `unsupported D-Bus address: transport unix, key ${firstKey}`;
    }
  }
  return undefined;
}

function pathError(code: string): Error {
  return Object.assign(new Error("invalid path"), { code });
}

function failed(input: RunInput, reason: string): Extract<RunOutcome, { kind: "failure" }> {
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
