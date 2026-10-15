import type { RegisterCommand } from "../cli.js";
import { readTextFile } from "../read-text-file.js";
import { verifyCommandLogPath } from "../store/layout.js";
import {
  fail,
  ISSUE_ARGUMENT_DESCRIPTION,
  loadConfigOrFail,
  REPO_OPTION_DESCRIPTION,
  wholeNumberOptionsOrFail,
  withFinalLineEnd,
  withIssueTask,
} from "./shared.js";

export const showVerify: RegisterCommand = (program, io) => {
  program
    .command("show-verify")
    .description("Print one verify run of the task of an issue: its result and the log of each command")
    .argument("<issue>", ISSUE_ARGUMENT_DESCRIPTION)
    .option("--repo <key>", REPO_OPTION_DESCRIPTION)
    .option("--run <N>", "Print this verify run: a whole number of 1 or more. The default is the newest run")
    .action((issue: string, options: { repo?: string; run?: string }) => {
      wholeNumberOptionsOrFail(io, { "--run": options.run });
      const config = loadConfigOrFail(io);
      io.stdout(
        withIssueTask(io, config, issue, { repo: options.repo }, (store, task) => {
          const total = store.verifyRunCount(task.id);
          if (total === 0) fail(io, `the task of ${task.issueKey} has no verify run; run tasker verify first`);
          if (options.run !== undefined && Number(options.run) > total) {
            fail(io, `the task of ${task.issueKey} has no verify run ${options.run}; it has ${total}`);
          }
          const run =
            options.run === undefined ? store.latestVerifyRun(task.id)! : store.getVerifyRun(task.id, Number(options.run))!;
          const header = `${task.issueKey} verify run ${run.number} of ${total}: ${run.result} (${run.startedAt})\n`;
          if (run.commands.length === 0) return `${header}\nno logs: this run ran no command\n`;
          const blocks = run.commands.map((command, i) => {
            const path = verifyCommandLogPath(config.dataRoot, task, run.number, i + 1);
            const file = readTextFile(path);
            const body = file.text === undefined ? `(log not readable: ${file.error})\n` : withFinalLineEnd(file.text);
            return `\n== command ${i + 1}: ${command} (${path}) ==\n${body}`;
          });
          return header + blocks.join("");
        }),
      );
    });
};
