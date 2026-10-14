import { runAssistant } from "../../src/process/run-assistant.js";
import { signalListenerCounts } from "../helpers.js";

// Runs one command with runAssistant and prints the result as one JSON line.
// Arguments: cwd, deadlineMs (from now), command.
// It never calls process.exit, so a timer or a listener that outlives the run keeps it alive.
const [cwd, deadlineMs, command] = process.argv.slice(2) as [string, string, string];

const lines: string[] = [];
const before = signalListenerCounts();
const result = await runAssistant("/bin/bash", ["-c", command], {
  cwd,
  env: { PATH: process.env.PATH },
  prompt: "",
  deadline: Date.now() + Number(deadlineMs),
  onLine: (line) => lines.push(line),
  onSpawn: () => {},
});
const after = signalListenerCounts();
console.log(JSON.stringify({ result, lines, before, after }));
