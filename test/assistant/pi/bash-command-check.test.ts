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
  input: "a shell or source reads commands that the guard extension cannot see",
  binding: "a command can bind a name to another program",
  option: "an unknown option of git or of a shell",
  array: "an array index can run a command",
  gitConfig: "git can run a command line from a configuration value",
  xargs: "xargs can add a denied command from its input",
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
  { command: 'echo "`git push`"', result: "match" },
  { command: "echo \"<<'EOF'\"\ngit push\nEOF", result: "match" },
  { command: "echo hi\ngit push", result: "match" },
  { command: "time -p git push", result: "match" },
  { command: "coproc git push", result: "match" },
  { command: "2>&1 git push", result: "match" },
  { command: "> /tmp/x git push", result: "match" },
  { command: "if git push; then :; fi", result: "match" },
  { command: "while git push; do :; done", result: "match" },
  { command: "f() ( git push )", result: "match" },
  { command: 'cat <<"EOF"\n$(git push)\nEOF\ngit push', result: "match" },
  { command: "$'git' push", result: "cause", cause: CAUSES.expansion },
  { command: "gi\\\nt push", result: "match" },
  { command: "git\\\n push", result: "match" },
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
  { command: "sh -c 'git push'", result: "match" },
  { command: 'bash -lc "git push"', result: "match" },
  { command: "bash -co errexit 'git push'", result: "match" },
  { command: 'bash -c "$X"', result: "cause", cause: CAUSES.expansion },
  { command: "bash <(echo git push)", result: "cause", cause: CAUSES.expansion },
  { command: "bash /dev/stdin <<< 'git push'", result: "cause", cause: CAUSES.input },
  { command: "echo 'git push' | bash", result: "cause", cause: CAUSES.input },
  { command: ". <(echo git push)", result: "cause", cause: CAUSES.expansion },
  { command: "hash -p /usr/bin/git g", result: "cause", cause: CAUSES.binding },
  { command: "BASH_CMDS[g]=/usr/bin/git", result: "cause", cause: CAUSES.binding },
  { command: "bash //dev/stdin <<< 'git push'", result: "cause", cause: CAUSES.input },
  { command: "bash run.sh < input.txt", result: "cause", cause: CAUSES.input },
  { command: "bash run.sh", result: "pass" },
  { command: "bash *.sh", result: "cause", cause: CAUSES.expansion },
  { command: "alias g=git", result: "cause", cause: CAUSES.binding },
  { command: "fc -s status=push", result: "cause", cause: CAUSES.binding },
  { command: "BASH_ENV=<(echo git push) bash -c true", result: "cause", cause: CAUSES.binding },
  { command: "grep -n '$(' file", result: "pass" },
  { command: "let 'x=a[$(git push)]'", result: "cause", cause: CAUSES.array },
  { command: "eval 'git push'", result: "match" },
  { command: "fish -C 'git push' x", result: "cause", cause: CAUSES.option },
  { command: "trap 'git push' EXIT", result: "cause", cause: CAUSES.binding },
  { command: "alias p='git push'", result: "cause", cause: CAUSES.binding },
  { command: "bash -s", result: "cause", cause: CAUSES.input },
  { command: "bash /./dev/stdin <<< 'git push'", result: "cause", cause: CAUSES.input },
  { command: "arr['b[$(git push)]']=1", result: "cause", cause: CAUSES.array },
  { command: "/usr/bin/git -C . --no-pager push origin", result: "match" },
  { command: "git -c alias.p=push p", result: "cause", cause: CAUSES.gitConfig },
  { command: "git -c help.autocorrect=immediate psuh", result: "cause", cause: CAUSES.gitConfig },
  { command: "git --frobnicate push", result: "cause", cause: CAUSES.option },
  { command: "git --frobnicate status", entries: ["herdr"], result: "pass" },
  { command: "git grep -O'git push' hi", result: "match" },
  { command: "git clone -u 'git push' . x", result: "match" },
  { command: "git -c core.fsmonitor='git push' status", result: "cause", cause: CAUSES.gitConfig },
  { command: "git -c user.name=x commit", result: "cause", cause: CAUSES.gitConfig },
  { command: "GIT_EDITOR='git push' git commit", result: "match" },
  { command: "git rebase -x 'git push' HEAD~1", result: "match" },
  { command: "env -i A=b git push", result: "match" },
  { command: "nice -n 5 timeout 9 git push", result: "match" },
  { command: "echo git push | xargs env", result: "cause", cause: CAUSES.xargs },
  { command: "find . -name '*.ts' -exec git push \\;", result: "match" },
  { command: "find . -name git -exec {} push \\;", result: "cause", cause: CAUSES.expansion },
  { command: "find . -name *.ts -print", result: "pass" },
  { command: "find . *", result: "cause", cause: CAUSES.expansion },
  { command: "timeout 60 npm test -- $FILE", result: "cause", cause: CAUSES.expansion },
  { command: "echo push | xargs git", result: "cause", cause: CAUSES.xargs },
  { command: "xargs -I{} sh -c '{}'", result: "cause", cause: CAUSES.xargs },
  { command: "xargs grep -l git", result: "cause", cause: CAUSES.xargs },
  { command: "find . -exec {} push \\;", result: "cause", cause: CAUSES.expansion },
  { command: "find . -exec sh -c '{}' \\;", result: "cause", cause: CAUSES.expansion },
];

function expectedResult(row: CommandRow): { block: false } | { block: true; reason: string } {
  if (row.result === "pass") return { block: false };
  if (row.result === "match") {
    const entry = row.entry ?? DENIED;
    return { block: true, reason: `tasker blocked this command: it runs "${entry}", which this run must not run.` };
  }
  return {
    block: true,
    reason: `tasker blocked this command: the guard extension cannot read it with certainty (${row.cause ?? ""}).`,
  };
}

function runPassingCommand(command: string): string {
  const root = useTempDir("tasker-bash-check-");
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  mkdirSync(bin);
  writeFileSync(log, "");

  for (const name of ["git", "herdr", "ls", "cat", "npm", "bash", "grep", "find"]) {
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

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function commandAtDepth(depth: number): string {
  let command = "git status";
  for (let nested = 1; nested < depth; nested += 1) command = "bash -c " + shellQuote(command);
  return command;
}

describe("checkBashCommand", () => {
  it.each(commandRows)("checks $command", (row) => {
    expect(checkBashCommand(row.command, row.entries ?? [DENIED])).toBe(expectedResult(row));
  });

  it("runs every passing table row through bash with stub commands", () => {
    const passingRows = commandRows.filter((row) => row.result === "pass");
    const records = passingRows.map((row) => runPassingCommand(row.command));

    expect(records.length).toBeGreaterThan(0);
  });

  it("chooses a denied match before a cause", () => {
    expect(checkBashCommand("echo $X; git push", [DENIED])).toEqual({
      block: true,
      reason: `tasker blocked this command: it runs "${DENIED}", which this run must not run.`,
    });
  });

  it("chooses the first denied entry from the entry list", () => {
    expect(checkBashCommand("herdr agent list && git push", [DENIED, "herdr"])).toEqual({
      block: true,
      reason: `tasker blocked this command: it runs "${DENIED}", which this run must not run.`,
    });
  });

  it("blocks a parse error after an earlier valid command", () => {
    expect(checkBashCommand("echo ok\necho hi; )", [DENIED])).toEqual({
      block: true,
      reason: `tasker blocked this command: the guard extension cannot read it with certainty (${CAUSES.parse}).`,
    });
  });

  it("blocks an internal error in the guard", () => {
    const entries = new Proxy([DENIED], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw new Error("internal test error");
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    expect(checkBashCommand("git status", entries)).toEqual({
      block: true,
      reason:
        "tasker blocked this command: the guard extension cannot read it with certainty (an error in the guard extension).",
    });
  });

  it("allows eight command-line levels and blocks nine", () => {
    expect(checkBashCommand(commandAtDepth(8), [DENIED])).toEqual({ block: false });
    expect(checkBashCommand(commandAtDepth(9), [DENIED])).toEqual({
      block: true,
      reason:
        "tasker blocked this command: the guard extension cannot read it with certainty (the command lines are nested more than 8 levels deep).",
    });
  });

  it("records the first cause by command text order", () => {
    expect(checkBashCommand('bash -c "$X"; hash -p /usr/bin/git g', [DENIED])).toEqual({
      block: true,
      reason:
        "tasker blocked this command: the guard extension cannot read it with certainty (" + CAUSES.expansion + ").",
    });
  });
});
