import { CommanderError } from "commander";
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
    .option("--command <N>", "Print only the log of the command at this position of the run, counted from 1")
    .action((issue: string, options: { repo?: string; run?: string; command?: string }) => {
      wholeNumberOptionsOrFail(io, { "--run": options.run, "--command": options.command });
      const config = loadConfigOrFail(io);
      const { text, unreadable } = withIssueTask(io, config, issue, { repo: options.repo }, (store, task) => {
        const total = store.verifyRunCount(task.id);
        if (total === 0) fail(io, `the task of ${task.issueKey} has no verify run; run tasker verify first`);
        if (options.run !== undefined && Number(options.run) > total) {
          fail(io, `the task of ${task.issueKey} has no verify run ${options.run}; it has ${total}`);
        }
        const run =
          options.run === undefined
            ? store.latestVerifyRun(task.id)!
            : store.getVerifyRun(task.id, Number(options.run))!;
        const count = run.commands.length;
        if (options.command !== undefined && Number(options.command) > count) {
          fail(
            io,
            `verify run ${run.number} of ${task.issueKey} has no log for command ${options.command}; it ran ${count} commands`,
          );
        }
        const header = `${task.issueKey} verify run ${run.number} of ${total}: ${run.result} (${run.startedAt})\n`;
        if (count === 0) return { text: `${header}\nno logs: this run ran no command\n`, unreadable: false };
        const positions =
          options.command === undefined ? run.commands.map((_command, i) => i + 1) : [Number(options.command)];
        let unreadable = false;
        const blocks = positions.map((position) => {
          const command = run.commands[position - 1];
          const path = verifyCommandLogPath(config.dataRoot, task, run.number, position);
          const file = readTextFile(path);
          if (file.text === undefined) unreadable = true;
          const body = file.text === undefined ? `(log not readable: ${file.error})\n` : withFinalLineEnd(file.text);
          return `\n== command ${position}: ${command} (${path}) ==\n${body}`;
        });
        return { text: header + blocks.join(""), unreadable };
      });
      io.stdout(text);
      if (unreadable) throw new CommanderError(1, "tasker.show-verify", "a verify log is not readable");
    });
};
