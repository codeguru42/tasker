import { closeSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { runInGroup } from "../../src/process/run-group.js";
import { signalListenerCounts } from "../helpers/processes.js";
import { signalInNextSpawn } from "./signal-in-spawn.js";
import { markWatching } from "./watching.js";

// Runs one command with runInGroup and prints the result as one JSON line.
// Arguments: cwd, logPath, deadlineMs (from now), holdMs, command, and optionally spawnSignal, file and startAfter.
// The file defaults to /bin/bash when it is empty or missing.
// If startAfter is "after-read", the fixture reads a file right before the call, so that the call starts after an await on I/O, as in tasker.
// If spawnSignal is not empty, the next spawn sends that signal to this process.
// If runInGroup rejects, the line holds error with the code and the message instead of result.
// It writes its pid to the file watching in cwd when runInGroup forwards the signals of this process.
// It never calls process.exit, so a timer or a listener that outlives the run keeps it alive.
const [cwd, logPath, deadlineMs, holdMs, command, spawnSignal, file, startAfter] = process.argv.slice(2) as [
  string,
  string,
  string,
  string,
  string,
  NodeJS.Signals | "" | undefined,
  string | undefined,
  string | undefined,
];

const before = signalListenerCounts();
const outputFd = openSync(logPath, "a");
if (spawnSignal) signalInNextSpawn(spawnSignal);
try {
  if (startAfter === "after-read") await readFile(import.meta.filename);
  const result = await runInGroup(file === undefined || file === "" ? "/bin/bash" : file, ["-c", command], {
    cwd,
    env: { PATH: process.env.PATH },
    outputFd,
    deadline: Date.now() + Number(deadlineMs),
    onSpawn: () => markWatching(cwd),
  });
  closeSync(outputFd);
  console.log(JSON.stringify({ result, before, after: signalListenerCounts() }));
} catch (error) {
  closeSync(outputFd);
  const { code, message } = error as { code: string; message: string };
  console.log(JSON.stringify({ error: { code, message }, before, after: signalListenerCounts() }));
}

if (Number(holdMs) > 0) setTimeout(() => {}, Number(holdMs));
