import { realCommandPath } from "./fake-commands.js";

// The helpers of the push guard tests: the exec scripts of a fake assistant turn that push to the remote or
// break it. The scripts run in the worktree of the task, on the task branch, and find the origin there.

export const shell = (script: string) => [realCommandPath("sh"), "-c", script];

// The script of a fake turn that sends signal to tasker, while the run of the turn holds the signal listeners.
export const signalTasker = (signal: NodeJS.Signals) => `kill -s ${signal.slice(3)} ${process.pid}`;

const git = realCommandPath("git");
const originOf = `o=$(${git} config remote.origin.url)`;

// Makes the task branch on the origin at main, as a push from the session would.
export const pushScript = `${originOf}; ${git} --git-dir "$o" branch "$(${git} branch --show-current)" main`;
export const pushBranch = shell(pushScript);

// Moves the origin folder away, so that the remote cannot be read.
export const moveOrigin = shell(`${originOf}; ${realCommandPath("mv")} "$o" "$o-gone"`);
