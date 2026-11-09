import { describe, expect, it } from "vitest";
import { parseBashCommand } from "../../../src/assistant/pi/bash-command-parse.js";
import { tokenizeBashCommand } from "../../../src/assistant/pi/bash-command-tokenize.js";

function commands(source: string): string[][] {
  return parseBashCommand(source).commands.map((command) => command.words.map((word) => word.value));
}

describe("parseBashCommand", () => {
  it.each([
    ["echo a; git push | head", [["echo", "a"], ["git", "push"], ["head"]]],
    ["A=1 >out git push", [["A=1", "git", "push"]]],
    ["(git push)", [["git", "push"]]],
    ["{ git push; }", [["git", "push"]]],
    ["if a; then b; elif c; then d; else e; fi", [["a"], ["b"], ["c"], ["d"], ["e"]]],
    ["while a; do b; done; until c; do d; done", [["a"], ["b"], ["c"], ["d"]]],
    ["for x in a b; do c; done; for ((i=0;i<1;i++)); do d; done", [["c"], ["d"]]],
    ["select x in a; do b; done", [["b"]]],
    ["case x in a) b;; c) d;& e) f;;& esac", [["b"], ["d"], ["f"]]],
    ["[[ x == y ]]; (( 1 + 1 ))", [["x", "==", "y"], [" 1 + 1 "]]],
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

  it("keeps redirection targets attached to their command", () => {
    expect(commands("echo >$(git push)")).toEqual([["echo", "git", "push"]]);
    expect(commands("echo a > $(git push)")).toEqual([["echo", "a", "git", "push"]]);
  });

  it("keeps plain here-document text as data", () => {
    expect(commands("cat <<EOF\ngit push\nEOF")).toEqual([["cat"]]);
  });

  it("keeps an unfinished here-document body through end of input", () => {
    expect(tokenizeBashCommand("cat <<EOF\nplain text\n$(git push)")).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "heredoc-body", value: "plain text\n$(git push)\n" })]),
    );
  });

  it("reads multiple quoted and unquoted here-documents", () => {
    expect(commands("cat <<A <<'B'\n$(git push)\nA\n$(git push)\nB")).toEqual([["cat"], ["git", "push"]]);
  });

  it("keeps reserved words in arguments as words", () => {
    expect(commands("echo then git push")).toEqual([["echo", "then", "git", "push"]]);
    expect(commands("echo do done fi")).toEqual([["echo", "do", "done", "fi"]]);
  });

  it("keeps source spans and quote and expansion parts", () => {
    const parsed = parseBashCommand(
      "echo 's' \"d\" $'a' $\"l\" \\x $p $(git status) $((1+1)) <(git log) *.ts {a,b} ~/file",
    );
    const words = parsed.commands[0]?.words ?? [];
    const kinds = words.flatMap((word) => word.parts.map((part) => part.kind));

    expect(kinds).toEqual(
      expect.arrayContaining([
        "single-quoted",
        "double-quoted",
        "ansi-quoted",
        "locale-quoted",
        "escape",
        "parameter",
        "substitution",
        "arithmetic",
        "process-substitution",
        "glob",
        "brace",
        "tilde",
      ]),
    );
    expect(words.every((word) => word.start !== undefined && word.end !== undefined && word.start < word.end)).toBe(
      true,
    );
    expect(words.some((word) => word.nested.some((command) => command.words[0]?.value === "git"))).toBe(true);
    expect(commands("gi\\\nt push")).toEqual([["git", "push"]]);
  });

  it("rejects malformed command input", () => {
    expect(() => parseBashCommand("echo ok; )")).toThrow();
  });
});
