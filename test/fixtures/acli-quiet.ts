// A child process for the runAcli quiet test. It calls runAcli and prints nothing unless a call goes wrong.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { runAcli } from "../../src/issues/jira/run.js";
import { writeFakeAcli } from "../helpers/fake-acli.js";
import { makeTempDir } from "../helpers/temp.js";

const dir = makeTempDir("tasker-acli-quiet-");
try {
  const binDir = join(dir, "bin");
  writeFakeAcli(binDir, join(dir, "acli.log"), [
    { args: ["jira", "workitem", "view", "TEST-1"], stdout: "out\n", stderr: "err\n" },
    { args: ["jira", "workitem", "view", "TEST-2"], stdout: "out\n", stderr: "err\n", exitCode: 1 },
  ]);
  const options = { env: { PATH: binDir } };
  // acli writes to stdout and stderr on success. runAcli must keep both away from the terminal.
  await runAcli(["jira", "workitem", "view", "TEST-1"], options);
  // A failing acli must not write to the terminal either.
  const failure = await runAcli(["jira", "workitem", "view", "TEST-2"], options).then(
    () => undefined,
    (error: unknown) => error,
  );
  if (failure === undefined) {
    throw new Error("acli was expected to fail, but it succeeded");
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
