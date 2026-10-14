# Rules of the repo

This page gives the rules for each change to this repo. [Code conventions](code-conventions.md) gives the details of the layout, the steps to add a command, the imports and the tests.

## Check

`npm run check` must pass before a change is complete.

## Tests

- Write the test first. Commit the failing test, then the code that makes it pass.
- Put shared test helpers in `test/helpers.ts`. Any change can add a helper there. Do not copy a helper into a test file.
- A change can edit an existing helper to fix a bug or to make the helper useful in more places. The change must not break the code that uses the helper.
- Tests must cover the behavior of each helper that other code uses. As a result, a change to a helper that breaks that code makes a test fail.
- The code in `src/` can have its own helpers. These helpers must stay separate from the test helpers. `src/` must not import from `test/`, and `test/helpers.ts` must hold no code that `src/` uses.

## Commits

- Each commit subject starts with a conventional prefix.
- The commit subject of a failing test is `test: <subject>`.
- The commit that makes the test pass uses the same commit subject with `feat:` or `fix:`.
- A docs change uses `docs:`.
- A change with no new behavior uses `refactor:`.
- Write each commit subject in the imperative, with a capital letter after the prefix, for example `feat: Add show-config to the tasker commands`.
- An implementation commit is a commit with the prefix `feat:`, `fix:` or `refactor:`.
- Each implementation commit passes `npm run check`.
- A `test:` commit can fail `npm run check`, but only for one reason: the new tests of that commit fail, because the behavior that the next commit adds is missing. All other tests pass.
- These rules are the goal for each commit on the branch when the work lands. They also apply after a rebase onto a newer base branch. A rebase can break a commit under the tip of the branch, also when the tip passes.
- For example, an earlier ticket landed a new configuration rule. A later ticket rebased onto it with `tasker update-branch`. The test configurations of the later ticket did not obey the new rule, and `tasker verify` failed. The agent fixed the tests in a new commit on top of the branch. As a result, the implementation commits under that fix failed `npm run check` on the base branch.
- A `docs:` commit has no rule for `npm run check`.
- tasker does not check these rules. An agent checks each commit only after a failed `tasker verify`. When `tasker verify` passes, nobody checks the commits under the tip. [docs/dev/orchestration.md](orchestration.md) gives the steps of the agent, in "The broken-commit steps".

## Docs

- The code is the source of truth. The docs do not describe anything that a reader can learn from the code directly. Examples are the names of functions, files, helpers, types and table columns, and the signatures, arguments, flags, return values and steps of a function.
- The rule above has one exception: a rule in a doc can name the file or folder that it applies to. For example, a rule can say where a kind of code goes, or which folder an import rule covers. "Put shared test helpers in `test/helpers.ts`" is such a rule, and it is allowed. The exception is narrow. A doc still does not list files, functions or helpers, and it does not describe what a file holds. For example, a list of the files of a folder is not allowed.
- The docs give only what the code cannot show. They give the purpose of a part, the reasons for a design and the rules that apply across files. They also give the limits and the facts about outside tools. An example of a fact about an outside tool is a git behavior that a flag guards against. A user does not read the code. As a result, the user docs (`docs/config.md` and `skills/tasker/SKILL.md`) describe the behavior that a user sees, for example the commands, the flags and the configuration.
- Update the docs in the same change as the code.
- Put a new command in `skills/tasker/SKILL.md` and in the `--help` output.
- Write the docs in plain English: short sentences, active voice, simple tenses, and "must" for a requirement.
- Do not use "should", "may", "might" or "could" in the docs.
- Use one word for one thing in each doc.
- When a doc gives a path in the home folder, write it as `$HOME/...`. Do not write it as `~/...` or as an absolute path such as `/home/<user>/...`.

## AGENTS.md

- `AGENTS.md` is an index. Each line is a one-line description plus a link to the file that has the details.
- Do not put rule text in `AGENTS.md`.
- To add a topic, put its details in its own file under `docs/`. Then add one line to `AGENTS.md`.
- `CLAUDE.md` has one line, `@AGENTS.md`, and nothing else.
