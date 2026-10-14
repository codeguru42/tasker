import { errnoCode } from "../errno.js";

// EPERM means that the process exists but belongs to another user.
export function pidIsLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = errnoCode(error);
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    throw error;
  }
}
