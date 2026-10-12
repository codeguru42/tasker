import type { RegisterCommand } from "../cli.js";
import { isTaskState, STATES } from "../state/machine.js";
import type { TaskFilter } from "../store/store.js";
import { fail, loadConfigOrFail, withStore } from "./shared.js";

const HEADERS = ["ISSUE", "REPO", "STATE", "UPDATED"];

// Left-aligned columns, as wide as the widest cell, two spaces apart, no trailing spaces.
function formatTable(rows: readonly string[][]): string {
  const all = [HEADERS, ...rows];
  const widths = HEADERS.map((_, i) => Math.max(...all.map((row) => row[i].length)));
  return all
    .map((row) => `${row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd()}\n`)
    .join("");
}

export const status: RegisterCommand = (program, io) => {
  program
    .command("status")
    .description("List the tasks by issue key and state")
    .option("--repo <key>", "List only the tasks of the repo with this key")
    .option("--state <state>", "List only the tasks in this state, also finished or cancelled")
    .action((options: { repo?: string; state?: string }) => {
      const config = loadConfigOrFail(io);
      const filter: TaskFilter = {};
      if (options.repo !== undefined) {
        if (!Object.hasOwn(config.repos, options.repo)) {
          fail(io, `repo key not found: ${options.repo}`);
        }
        filter.repoKey = options.repo;
      }
      if (options.state !== undefined) {
        if (!isTaskState(options.state)) {
          fail(io, `unknown state: ${options.state} (the states are: ${STATES.join(", ")})`);
        }
        filter.states = [options.state];
      }
      const tasks = withStore(config, (store) => store.listTasks(filter));
      io.stdout(
        tasks.length === 0
          ? "no tasks\n"
          : formatTable(tasks.map((t) => [t.issueKey, t.repoKey, t.state, t.updatedAt])),
      );
    });
};
