import { runAssistant } from "../../src/process/run-assistant.js";
import { signalListenerCounts } from "../helpers/processes.js";
import { signalInNextSpawn } from "./signal-in-spawn.js";
import { markWatching } from "./watching.js";

// Runs one command with runAssistant and prints the result as one JSON line.
// Arguments: cwd, deadlineMs (from now), command, and optionally spawnSignal and file.
// The file defaults to /bin/bash. If spawnSignal is not empty, the next spawn sends that signal to this process.
// It writes its pid to the file watching in cwd when runAssistant forwards the signals of this process.
// It never calls process.exit, so a timer or a listener that outlives the run keeps it alive.
const [cwd, deadlineMs, command, spawnSignal, file] = process.argv.slice(2) as [
  string,
  string,
  string,
  NodeJS.Signals | "" | undefined,
  string | undefined,
];

const lines: string[] = [];
const before = signalListenerCounts();
if (spawnSignal) signalInNextSpawn(spawnSignal);
const result = await runAssistant(file ?? "/bin/bash", ["-c", command], {
  cwd,
  env: { PATH: process.env.PATH },
  prompt: "",
  deadline: Date.now() + Number(deadlineMs),
  onLine: (line) => lines.push(line),
  onSpawn: () => markWatching(cwd),
});
const after = signalListenerCounts();
console.log(JSON.stringify({ result, lines, before, after }));
