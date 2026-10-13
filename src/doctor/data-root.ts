import { rmSync, statfs, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { createDataRoot, doctorProbePath } from "../store/layout.js";
import type { Check } from "./check.js";
import { errorMessage } from "./error-message.js";
import { timedCheck } from "./timed-check.js";

const WRITABLE = "Make sure that dataRoot names a folder that tasker can write in.";

// Makes the missing folders of dataRoot, then writes one new file there and deletes it again.
export function dataRootCheck(dataRoot: string, timeoutMs = 5000): Check {
  return timedCheck({ name: "data root", required: true, timeoutMs }, async () => {
    try {
      createDataRoot(dataRoot);
    } catch (error) {
      return {
        status: "error",
        detail: `cannot make the folders of the data root ${dataRoot}: ${errorMessage(error)}`,
        remediation: WRITABLE,
      };
    }
    const probe = doctorProbePath(dataRoot);
    try {
      writeFileSync(probe, "", { flag: "wx" });
    } catch (error) {
      return {
        status: "error",
        detail: `cannot write the file ${probe}: ${errorMessage(error)}`,
        remediation: WRITABLE,
      };
    }
    try {
      rmSync(probe);
    } catch (error) {
      return {
        status: "error",
        detail: `cannot delete the file ${probe}: ${errorMessage(error)}`,
        remediation: `Delete the file ${probe}.`,
      };
    }
    return { status: "ok", detail: `tasker can write and delete a file in ${dataRoot}` };
  });
}

// Gives warn when the space that a user who is not root can use is below minFreeBytes.
export function freeSpaceCheck(dataRoot: string, minFreeBytes: number, timeoutMs = 5000): Check {
  return timedCheck({ name: "free space", required: false, timeoutMs }, async () => {
    const stats = await promisify(statfs)(dataRoot);
    const free = stats.bavail * stats.bsize;
    if (free < minFreeBytes) {
      return {
        status: "warn",
        detail: `${free} bytes free in ${dataRoot}, below the limit of ${minFreeBytes} bytes`,
        remediation: "Make free space on the file system of dataRoot, or lower dataRootMinFreeBytes.",
      };
    }
    return { status: "ok", detail: `${free} bytes free in ${dataRoot} (limit ${minFreeBytes} bytes)` };
  });
}
