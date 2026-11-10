import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RunOutcome } from "../provider.js";
import { errnoCode } from "../../errno.js";
import { childTempRoot } from "../shared-sandbox-paths.js";
import type { Failure } from "./failure.js";

type StartFunction = (tempFolder: string, markSpawned: () => void) => Promise<RunOutcome>;
type FailureFunction = (error: unknown) => Failure;
type RemoveTempFolder = (tempFolder: string) => void;

export async function runWithStartTemp(
  env: NodeJS.ProcessEnv,
  start: StartFunction,
  failure: FailureFunction,
  removeTempFolder: RemoveTempFolder = removeFolder,
): Promise<RunOutcome> {
  let tempFolder: string;
  try {
    tempFolder = mkdtempSync(join(childTempRoot(env), "tasker-pi-"));
  } catch (error) {
    return failure(error);
  }

  let spawned = false;
  let outcome: RunOutcome | undefined;
  let startError: unknown;
  try {
    outcome = await start(tempFolder, () => {
      spawned = true;
    });
  } catch (error) {
    startError = error;
  }

  let cleanupError: string | undefined;
  try {
    removeTempFolder(tempFolder);
  } catch (error) {
    cleanupError = `sandbox temp folder cleanup failed: ${errnoCode(error) ?? "unknown"}`;
  }

  const result = outcome ?? failure(startError);
  if (cleanupError === undefined) return result;
  if (spawned) return { ...result, sandboxCleanup: { error: cleanupError } };
  if (result.kind !== "failure") return result;
  return { ...result, reason: `${result.reason}; ${cleanupError}` };
}

function removeFolder(tempFolder: string): void {
  rmSync(tempFolder, { recursive: true, force: true });
}
