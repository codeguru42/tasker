// A child process for the runGh quiet test. It calls runGh and prints nothing unless a call goes wrong.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { runGh } from "../../src/issues/github/run.js";
import { ghTokenAnswer, makeTempDir, writeFakeGh } from "../helpers.js";

const dir = makeTempDir("tasker-gh-quiet-");
try {
  const binDir = join(dir, "bin");
  writeFakeGh(binDir, join(dir, "gh.log"), [
    ghTokenAnswer("octo", "gho_quiet"),
    { args: ["api", "user"], stdout: "out\n", stderr: "err\n" },
    { args: ["issue", "view", "7"], stdout: "out\n", stderr: "err\n", exitCode: 1 },
  ]);
  const options = { account: "octo", env: { PATH: binDir } };
  // gh writes to stdout and stderr on success. runGh must keep both away from the terminal.
  await runGh(["api", "user"], options);
  // A failing gh must not write to the terminal either.
  const failure = await runGh(["issue", "view", "7"], options).then(
    () => undefined,
    (error: unknown) => error,
  );
  if (failure === undefined) {
    throw new Error("gh was expected to fail, but it succeeded");
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
