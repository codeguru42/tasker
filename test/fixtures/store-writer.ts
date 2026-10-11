// A child process for the store concurrency test.
// Arguments: dbPath, issueKey, count.
import { openStore } from "../../src/store/store.js";

const [dbPath, issueKey, countText] = process.argv.slice(2);
const count = Number(countText);

try {
  const store = openStore(dbPath);
  const task = store.createTask({ issueKey, repoKey: "tasker", state: "new" });
  for (let n = 0; n < count; n++) {
    store.appendEvent(task.id, "tick", { n });
  }
  for (let n = 0; n < count; n++) {
    store.updateTask(task.id, { state: String(n) });
  }
  store.close();
} catch (error) {
  console.error(error);
  process.exit(1);
}
