import type { RegisterCommand } from "../cli.js";
import { nextCell } from "../state/commands.js";
import { isTaskState, SPAWNING_STATES, STATES } from "../state/machine.js";
import type { TaskFilter } from "../store/store.js";
import { handleDeadRun } from "../tasks/dead-run.js";
import {
  fail,
  formatColumns,
  loadConfigOrFail,
  repoKeyOrFail,
  resolveIssueKeyOrFail,
  withStoreAsync,
} from "./shared.js";

const HEADERS = ["ISSUE", "REPO", "STATE", "UPDATED", "NEXT"];

export const status: RegisterCommand = (program, io) => {
  program
    .command("status")
    .description("List the tasks by issue key and state")
    .option("--repo <key>", "List only the tasks of the repo with this key")
    .option("--state <state>", "List only the tasks in this state, also finished or cancelled")
    .option("--issue <issue>", "List only the tasks of this issue key")
    .action(async (options: { repo?: string; issue?: string; state?: string }) => {
      const config = loadConfigOrFail(io);
      const filter: TaskFilter = {};
      if (options.repo !== undefined) {
        repoKeyOrFail(io, config, options.repo);
        filter.repoKey = options.repo;
      }
      if (options.state !== undefined) {
        if (!isTaskState(options.state)) {
          fail(io, `unknown state: ${options.state} (the states are: ${STATES.join(", ")})`);
        }
        filter.states = [options.state];
      }
      if (options.issue !== undefined) {
        const ref = resolveIssueKeyOrFail(io, options.issue, config, { repo: options.repo });
        filter.issueKey = ref.key;
        filter.repoKey = ref.repoKey;
      }
      const tasks = await withStoreAsync(config, async (store) => {
        // Each task in a spawning state is checked, also a task that the filter hides.
        for (const task of store.listTasks({ states: [...SPAWNING_STATES] })) {
          for (const note of (await handleDeadRun(store, task)).notes) io.stderr(`${note}\n`);
        }
        return store.listTasks(filter);
      });
      io.stdout(
        tasks.length === 0
          ? "no tasks\n"
          : formatColumns([
              HEADERS,
              ...tasks.map((t) => [t.issueKey, t.repoKey, t.state, t.updatedAt, nextCell(t.state)]),
            ])
              .map((line) => `${line}\n`)
              .join(""),
      );
    });
};
