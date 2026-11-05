import { join } from "node:path";
import { createGhSession } from "../../src/github/forge-session.js";
import { shellQuote } from "../../src/shell-quote.js";
import { fakeAnswerScript, writeFakeCommand } from "../helpers/fake-commands.js";

const dir = process.argv[2];
if (dir === undefined) throw new Error("forge quiet fixture needs a folder");

const token = "forge-token-secret";
const binDir = join(dir, "bin");
const logPath = join(dir, "forge-gh.log");
const answers = [
  { args: ["auth", "token", "--user", "octo"], stdout: `${token}\n` },
  { args: ["repo", "view"], stdout: `${token}\n`, stderr: `${token}\n`, exitCode: 1 },
];
const tokenMatch = `"$(if [ "\${GH_TOKEN-}" = ${shellQuote(token)} ]; then printf set:true; else printf set:false; fi)"`;
writeFakeCommand(binDir, "gh", fakeAnswerScript("gh", logPath, answers, [tokenMatch, '"set:$PWD"']));
const session = createGhSession("octo");
const env = {
  TASKER_PATH: binDir,
  TASKER_HOME: `${dir}/home`,
  TASKER_GH_CONFIG_DIR: `${dir}/gh-config`,
  TASKER_GH_BIN: join(binDir, "gh"),
};

const failure = await session.run(["repo", "view"], dir, env).then(
  () => undefined,
  (error: unknown) => error,
);
if (failure === undefined) throw new Error("the forge command was expected to fail");
