import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../../helpers/temp.js";
import { checkBashCommand } from "../../../src/assistant/pi/bash-command-check.js";

const DENIED = "git push";

const CAUSES = {
  parse: "the line does not parse",
  expansion: "an expansion can change a command name or a word of a denied command",
};

interface CommandRow {
  command: string;
  entries?: string[];
  result: "pass" | "match" | "cause";
  cause?: string;
  entry?: string;
}

const commandRows: CommandRow[] = [
  { command: "git status && ls", result: "pass" },
  { command: "cd /tmp && git push", result: "match" },
  { command: 'echo "git push"', result: "pass" },
  { command: "A=1 B=2 git push", result: "match" },
  { command: "echo $(git push)", result: "match" },
  { command: "echo `git push`", result: "match" },
  { command: "echo ${x:-$(git push)}", result: "match" },
  { command: "cat <<EOF\n$(git push)\nEOF", result: "match" },
  { command: "cat <<'EOF'\n$(git push)\nEOF", result: "pass" },
  { command: "f() { git push; }", result: "match" },
  { command: "echo hi; )", result: "cause", cause: CAUSES.parse },
  { command: "herdr agent list", entries: [DENIED, "herdr"], result: "match", entry: "herdr" },
  { command: "ls ~/herdr", entries: ["herdr"], result: "pass" },
  { command: "/usr/bin/herdr", entries: ["herdr"], result: "match", entry: "herdr" },
  { command: "./herdr", entries: ["herdr"], result: "match", entry: "herdr" },
  { command: "/usr/lib/git-core/git-push", result: "match" },
  { command: "'git' push", result: "match" },
  { command: "g\\it push", result: "match" },
  { command: '"git" "push"', result: "match" },
  { command: "arr[0]=x", result: "pass" },
  { command: "arr[0]=x npm test", result: "pass" },
  { command: "arr[0]=x git push", result: "match" },
  { command: "gi[t] push", result: "cause", cause: CAUSES.expansion },
  { command: "{gh,} api", result: "cause", cause: CAUSES.expansion },
  { command: "$cmd push", result: "cause", cause: CAUSES.expansion },
  { command: '"$(which git)" push', result: "cause", cause: CAUSES.expansion },
  { command: '"$@"', result: "cause", cause: CAUSES.expansion },
];

function expectedResult(row: CommandRow): string | null {
  if (row.result === "pass") return null;
  if (row.result === "match") {
    const entry = row.entry ?? DENIED;
    return `tasker blocked this command: it runs "${entry}", which this run must not run.`;
  }
  return `tasker blocked this command: the guard extension cannot read it with certainty (${row.cause ?? ""}).`;
}

function runPassingCommand(command: string): string {
  const root = useTempDir("tasker-bash-check-");
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  mkdirSync(bin);
  writeFileSync(log, "");

  for (const name of ["git", "herdr", "ls", "cat", "npm"]) {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\nprintf '%s %s\\n' '${name}' "$*" >> "$TASKER_BASH_STUB_LOG"\n`);
    chmodSync(path, 0o755);
  }

  const result = spawnSync("/bin/bash", ["-c", command], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TASKER_BASH_STUB_LOG: log,
    },
  });
  expect(result.error).toBeUndefined();
  const records = readFileSync(log, "utf8");
  expect(records).not.toMatch(/(?:^|\s)git push(?:\s|$)/);
  expect(records).not.toMatch(/(?:^|\s)herdr(?:\s|$)/);
  return records;
}

describe("checkBashCommand", () => {
  it.each(commandRows)("checks $command", (row) => {
    expect(checkBashCommand(row.command, row.entries ?? [DENIED])).toBe(expectedResult(row));
  });

  it("runs every passing table row through bash with stub commands", () => {
    const passingRows = commandRows.filter((row) => row.result === "pass");
    const records = passingRows.map((row) => runPassingCommand(row.command));

    expect(records.some((record) => record.includes("git status"))).toBe(true);
    expect(records.some((record) => record.includes("npm test"))).toBe(true);
  });

  it("chooses a denied match before a cause", () => {
    expect(checkBashCommand("echo $X; git push", [DENIED])).toBe(
      `tasker blocked this command: it runs "${DENIED}", which this run must not run.`,
    );
  });

  it("chooses the first denied entry from the entry list", () => {
    expect(checkBashCommand("herdr agent list && git push", [DENIED, "herdr"])).toBe(
      `tasker blocked this command: it runs "${DENIED}", which this run must not run.`,
    );
  });

  it("blocks a parse error after an earlier valid command", () => {
    expect(checkBashCommand("echo ok\necho hi; )", [DENIED])).toBe(
      `tasker blocked this command: the guard extension cannot read it with certainty (${CAUSES.parse}).`,
    );
  });

  it("blocks an internal error in the guard", () => {
    const entries = new Proxy([DENIED], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error("internal test error");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(checkBashCommand("git status", entries)).toBe(
      "tasker blocked this command: the guard extension cannot read it with certainty (an error in the guard extension).",
    );
  });
});
