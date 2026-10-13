import { closeSync, openSync } from "node:fs";
import { runInGroup } from "../../src/process/run-group.js";

// Runs one command with runInGroup and prints the result as one JSON line.
// Arguments: cwd, logPath, deadlineMs (from now), holdMs, command.
// It never calls process.exit, so a timer or a listener that outlives the run keeps it alive.
const [cwd, logPath, deadlineMs, holdMs, command] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string,
];

function listenerCounts(): number[] {
  return [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
}

const before = listenerCounts();
const outputFd = openSync(logPath, "a");
const result = await runInGroup("/bin/bash", ["-c", command], {
  cwd,
  env: { PATH: process.env.PATH },
  outputFd,
  deadline: Date.now() + Number(deadlineMs),
});
closeSync(outputFd);
const after = listenerCounts();
console.log(JSON.stringify({ result, before, after }));

if (Number(holdMs) > 0) setTimeout(() => {}, Number(holdMs));
