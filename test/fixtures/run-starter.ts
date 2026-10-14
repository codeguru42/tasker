// A child process for the run marker tests. It moves a task into a spawning state one time, prints
// "started" and stays alive until it is killed. Arguments: dbPath, taskId, state.
import { openStore } from "../../src/store/store.js";

const [dbPath, taskId, state] = process.argv.slice(2);

try {
  const store = openStore(dbPath);
  store.startRun(Number(taskId), state);
  console.log("started");
  setInterval(() => {}, 1000);
} catch (error) {
  console.error(error);
  process.exit(1);
}
