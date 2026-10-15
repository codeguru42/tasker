# Rules of the repo

This page gives the rules for each change to this repo. [Code conventions](code-conventions.md) gives the details of the layout, the steps to add a command, the imports, the zod facts and the tests.

## Check

`npm run check` must pass before a change is complete.

## Tests

- Write the test first. Commit the failing test, then the code that makes it pass.
- Put shared test helpers in `test/helpers/`. Any change can add a helper there. A helper goes in the file of its kind, and a new kind gets a new file. Do not copy a helper into a test file.
- A change can edit an existing helper to fix a bug or to make the helper useful in more places. The change must not break the code that uses the helper.
- Tests must cover the behavior of each helper that other code uses. As a result, a change to a helper that breaks that code makes a test fail.
- The code in `src/` can have its own helpers. These helpers must stay separate from the test helpers. `src/` must not import from `test/`, and the files in `test/helpers/` must hold no code that `src/` uses.
- Code in `src/` and in `test/` must call an existing helper for the job of that helper. It must not repeat the steps of a helper. When two or more places repeat the same steps and no helper exists, add one helper and call it from each place. A place repeats a helper only when it repeats all the steps of the helper. A place that already holds the input of a later step, for example an open store, and does only that one step, keeps its own call. There, a call of the helper does the earlier steps again.
- The expected-value exception to the helper rule above: a test helper that computes the expected value of a test without the code under test is not a copy of a helper of `src/`. If the test called the helper of `src/`, a bug in that helper changes the expected value and the real value in the same way, and the test passes.
- Give each function under test one call helper in the outer scope of its test file. Each test calls the function through that helper. If more than one test file needs the same call helper, put it in `test/helpers/`, as the rule on shared helpers says.
- A test of a failure path proves that the failure happened, for example with a side effect or a count of the calls. A test that only checks that no error was thrown does not prove it.

## Code

These rules apply to the code in `src/` and in `test/`. The one-home rule also applies to the docs.

- The one-home rule: each rule and each fact has at most one home in the code and at most one home in the docs. Other places call the code or link to the doc. A change that moves a rule removes each old copy. An old copy can also be a sentence in a doc that states the same rule in other words. For the steps of the code, the helper rule in [Tests](#tests) gives the details.
- A check of input reports all its problems in one run, not only the first one. Examples of input are the configuration and an answer of the assistant. A check that needs a valid shape can wait until the check of the shape passes. [code-conventions.md](code-conventions.md#zod) gives the zod facts for both kinds of check.
- Each path in the data root that the code in `src/` uses comes from `src/store/layout.ts`. No other file in `src/` builds a data-root path. A test can build its expected path itself, as the expected-value exception in [Tests](#tests) allows.
- Do not keep dead code: no unused return value, no unused export and no check that cannot fail. When a change removes the last caller of a function in `src/`, the same change also removes that function. A call from a test does not count as a caller. This does not apply when the function implements an interface, for example a method of a provider or of a store interface. It also does not apply when an open issue names the function, or the step that it does, as work for a later ticket. The rule covers only a function that lost its callers in the same change. A function that a change adds for a later ticket stays, also as an unused export. An example is the shared result step of #101, which #92 called first.
- A general helper keeps its promise for each input that its type accepts, not only for the inputs that its callers send today.

A case is one kind of input that a function serves. Examples are a role of an assistant run (plan, execute or review), a provider id and a kind of task.

- When the cases of a function differ only in data, one shared function serves all of them. The data is, for example, a table or an object with one entry for each case. A check of the case that only picks the entry of the data is allowed. A switch on a provider id that only picks the provider of that id is such a check.
- When the cases differ in code, each case gets its own function. An example of a difference in code is an `if` or a `switch` on the case that runs other steps. Steps that only some cases do are also a difference in code.
- Separate functions share code only where the steps are truly the same. Find the shared steps during the work, when two functions show the same steps. Do not build a shared core for the cases at the start. Then the helper rule in [Tests](#tests) applies to the shared steps.
- For example, one entry point runs the assistant in the roles plan, execute and review. While the roles differ only in a table of limits, the entry point stays one function. If one role needs other steps, that role gets its own entry point.
- These rules do not split a function only because its cases differ in values, for example a limit, a message or a model. Such values are data.

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
- The rule above has one exception: a rule in a doc can name the file or folder that it applies to. For example, a rule can say where a kind of code goes, or which folder an import rule covers. "Put shared test helpers in `test/helpers/`" is such a rule, and it is allowed. The exception is narrow. A doc still does not list the functions, helpers or types of a file. A plain list of the files of a folder is not allowed either. A list that gives the purpose of each folder or file that it names is allowed, for example a layout or an index.
- The docs give only what the code cannot show. They give the purpose of a part, the reasons for a design and the rules that apply across files. They also give the limits and the facts about outside tools. An example of a fact about an outside tool is a git behavior that a flag guards against. A user does not read the code. As a result, the user docs (`docs/config.md` and `skills/tasker/SKILL.md`) describe the behavior that a user sees, for example the commands, the flags and the configuration.
- Update the docs in the same change as the code.
- Put a new command in `skills/tasker/SKILL.md` and in the `--help` output.
- Write the docs with the simple-english skill. The skill holds the rules of the text, for example the banned words and the sentence limits.
- When a doc gives a path in the home folder, write it as `$HOME/...`. Do not write it as `~/...` or as an absolute path such as `/home/<user>/...`.

## AGENTS.md

- `AGENTS.md` is an index. Each line is a one-line description plus a link to the file that has the details.
- Do not put rule text in `AGENTS.md`.
- To add a topic, put its details in its own file under `docs/`. Then add one line to `AGENTS.md`.
- `CLAUDE.md` has one line, `@AGENTS.md`, and nothing else.
