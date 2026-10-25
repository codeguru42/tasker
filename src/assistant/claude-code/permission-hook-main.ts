import { readFileSync } from "node:fs";
import { permissionAnswer } from "./permission-hook.js";

// The entry file of the hook command. It has no logic: see permissionAnswer.
let text = "";
try {
  text = readFileSync(0, "utf8");
} catch {
  // An unreadable stdin gives "", and the answer is a deny.
}
process.stdout.write(`${permissionAnswer(text, process.argv[2] ?? "")}\n`);
