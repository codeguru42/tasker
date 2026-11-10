import { realpathSync, statSync } from "node:fs";
import { errnoCode } from "../../errno.js";
import { findOnPath } from "../../process/resolve-program.js";
import type { RunInput, RunOutcome } from "../provider.js";
import { runWithStartTemp } from "./start-temp.js";
import { sandboxArgs } from "./sandbox-args.js";
import type { PiSandboxLimits } from "./guard-limits.js";
import { sandboxPart } from "./sandbox-part.js";
import { spawnPiBwrap } from "../../process/pi-bwrap.js";
import { parseDbusAddress } from "./dbus-address.js";
import { failed } from "./failure.js";

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

  const dbus = parseDbusAddress(input.env.DBUS_SESSION_BUS_ADDRESS);
  if ("reason" in dbus) return failed(input, dbus.reason);

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

      const hideValidation = sandboxArgs({ sandbox, cwd: worktree, command: "true" });
      if ("reason" in hideValidation) return failed(input, hideValidation.reason);

      const probe = sandboxArgs({
        sandbox: { ...sandbox, hidePaths: [] },
        cwd: worktree,
        command: "true",
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

function pathError(code: string): Error {
  return Object.assign(new Error("invalid path"), { code });
}
