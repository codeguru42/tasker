// A child process for the lock tests. It takes a lock one time and stays alive until it is killed.
// Arguments: dbPath, name, and an optional goPath. With a goPath, the child writes the file
// `${goPath}.ready.<pid>` and waits until the file goPath exists, before it takes the lock.
import { existsSync, writeFileSync } from "node:fs";
import { openStore } from "../../src/store/store.js";

const [dbPath, name, goPath] = process.argv.slice(2);

try {
  const store = openStore(dbPath);
  if (goPath !== undefined) {
    writeFileSync(`${goPath}.ready.${process.pid}`, "");
    while (!existsSync(goPath)) {
      await new Promise((done) => setTimeout(done, 5));
    }
  }
  console.log(JSON.stringify(store.tryLock(name)));
  setInterval(() => {}, 1000);
} catch (error) {
  console.error(error);
  process.exit(1);
}
