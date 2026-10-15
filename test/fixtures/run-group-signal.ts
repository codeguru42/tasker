import { closeSync, openSync } from "node:fs";
import { runInGroup } from "../../src/process/run-group.js";
import { signalListenerCounts } from "../helpers/processes.js";
import { markWatching } from "./watching.js";

// Runs one command with runInGroup and prints the result as one JSON line.
// Arguments: cwd, logPath, deadlineMs (from now), holdMs, command.
// It writes its pid to the file watching in cwd when runInGroup forwards the signals of this process.
// It never calls process.exit, so a timer or a listener that outlives the run keeps it alive.
const [cwd, logPath, deadlineMs, holdMs, command] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string,
];

const before = signalListenerCounts();
const outputFd = openSync(logPath, "a");
const result = await runInGroup("/bin/bash", ["-c", command], {
  cwd,
  env: { PATH: process.env.PATH },
  outputFd,
  deadline: Date.now() + Number(deadlineMs),
  onSpawn: () => markWatching(cwd),
});
closeSync(outputFd);
const after = signalListenerCounts();
console.log(JSON.stringify({ result, before, after }));

if (Number(holdMs) > 0) setTimeout(() => {}, Number(holdMs));
