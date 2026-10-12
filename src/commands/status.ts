import type { RegisterCommand } from "../cli.js";
import { loadConfigOrFail, withStore } from "./shared.js";

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
    .action(() => {
      const config = loadConfigOrFail(io);
      const tasks = withStore(config, (store) => store.listTasks({}));
      io.stdout(
        tasks.length === 0
          ? "no tasks\n"
          : formatTable(tasks.map((t) => [t.issueKey, t.repoKey, t.state, t.updatedAt])),
      );
    });
};
