import { describe, expect, it } from "vitest";
import { parseBashCommand } from "../../../src/assistant/pi/bash-command-parse.js";

function commands(source: string): string[][] {
  return parseBashCommand(source).commands.map((command) => command.words.map((word) => word.value));
}

describe("parseBashCommand", () => {
  it.each([
    ["echo a; git push | head", [["echo", "a"], ["git", "push"], ["head"]]],
    ["A=1 >out git push", [["A=1", "out", "git", "push"]]],
    ["(git push)", [["git", "push"]]],
    ["{ git push; }", [["git", "push"]]],
    ["if a; then b; elif c; then d; else e; fi", [["a"], ["b"], ["c"], ["d"], ["e"]]],
    ["while a; do b; done; until c; do d; done", [["a"], ["b"], ["c"], ["d"]]],
    ["for x in a b; do c; done; for ((i=0;i<1;i++)); do d; done", [["a", "b"], ["c"], ["d"]]],
    ["select x in a; do b; done", [["a"], ["b"]]],
    ["case x in a) b;; c) d;& e) f;;& esac", [["b"], ["d"], ["f"]]],
    [
      "[[ x == y ]]; (( 1 + 1 ))",
      [
        ["x", "==", "y"],
        ["1", "+", "1"],
      ],
    ],
    [
      "f() { git push; }; function g { git push; }",
      [
        ["git", "push"],
        ["git", "push"],
      ],
    ],
  ])("reads command words in %s", (source, expected) => {
    expect(commands(source)).toEqual(expected);
  });

  it.each([
    "echo ok\ngit push",
    "time -p git push",
    "coproc git push",
    ">out git push",
    "if git push; then :; fi",
    "echo \"<<'EOF'\"\ngit push\nEOF",
    'cat <<"EOF"\n$(git push)\nEOF\ngit push',
    'echo "`git push`"',
    "$'git' push",
    "gi\\\nt push",
  ])("finds nested or continued command in %s", (source) => {
    expect(commands(source).flat().join(" ")).toContain("git");
  });

  it("keeps quoted here document bodies literal and reads after the delimiter", () => {
    expect(commands("cat <<'EOF'\n$(git push)\nEOF\ngit status")).toEqual([["cat"], ["git", "status"]]);
  });

  it("rejects malformed command input", () => {
    expect(() => parseBashCommand("echo ok; )")).toThrow();
  });
});
