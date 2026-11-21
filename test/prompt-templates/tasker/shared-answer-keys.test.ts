import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPromptTemplate } from "../../../src/prompts/template-file.js";
import { repoRoot } from '../../helpers/processes.js';
import { fragmentProblems } from '../../helpers/prompt-templates.js';

const path = join(fileURLToPath(repoRoot), 'prompt-templates', 'tasker', 'shared-answer-keys.md');

describe('shared-answer-keys', () => {
  it('is a fragment file with the exact text of the rule', () => {
    expect(fragmentProblems(path, "   - `summary`: short points on the approach, the main parts that change and the risks.\n   - `plan_markdown`: the plan. It starts with `## Summary`, then gives the approach, the files to change, the tests, the documentation and the risks.\n   - `files_changed`: the path, relative to the repository, of each file that the plan creates, changes or deletes (code, tests and docs), with no leading `./`. tasker compares this list with the other tasks in flight to warn about merge conflicts, so list each file and only those files.\n   - `todos`: the work in small steps. Each todo has a kebab-case `id`, a `title`, a `description` and `depends_on` (the ids of the todos that must come first, or an empty list). The `title` is the commit subject of the work without its prefix, and it follows the commit rules of the repository. A failing-test todo and the todo that makes it pass have the same title. Put the failing test and the code in two todos, and make the code todo depend on the test todo. Never give an empty list. For a very small change, give one todo. The rules of the repository can ask for commands before each commit, for example a formatter, a linter or the whole test suite. Find these rules in the files of the repository, for example a contributing guide or the instructions for an assistant. Each todo that makes a commit runs each such command before the commit, and the todo names each command and its pass condition. For the commit of a failing test, the pass condition permits each failure that the rules of the repository permit for such a commit. A todo runs no other check of the whole repository. tasker runs the verify commands itself after the execute run.\n   - `questions`: each real open point that the code cannot answer. Empty when there is none.")).toEqual([]);
  });

  it('allows required checks before commits', () => {
    const body = readPromptTemplate(path).body;
    expect(body).toContain("The rules of the repository can ask for commands before each commit, for example a formatter, a linter or the whole test suite. Find these rules in the files of the repository, for example a contributing guide or the instructions for an assistant. Each todo that makes a commit runs each such command before the commit, and the todo names each command and its pass condition. For the commit of a failing test, the pass condition permits each failure that the rules of the repository permit for such a commit. A todo runs no other check of the whole repository. tasker runs the verify commands itself after the execute run.");
    expect(body).not.toContain("A todo never runs the full test suite or another check of the whole repository, because tasker runs the verify commands itself after the execute run.");
  });
});
