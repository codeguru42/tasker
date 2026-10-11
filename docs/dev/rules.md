# Rules of the repo

This page gives the rules for each change to this repo. [Code conventions](code-conventions.md) gives the details of the layout, the steps to add a command, the imports and the tests.

## Check

`npm run check` must pass before a change is complete.

## Tests

- Write the test first. Commit the failing test, then the code that makes it pass.
- Put shared test helpers in `test/helpers.ts`. Do not copy a helper into a test file.

## Commits

- Each commit subject starts with a conventional prefix.
- The commit subject of a failing test is `test: <subject>`.
- The commit that makes the test pass uses the same commit subject with `feat:` or `fix:`.
- A docs change uses `docs:`.
- A change with no new behavior uses `refactor:`.
- Write each commit subject in the imperative, with a capital letter after the prefix, for example `feat: Add show-config to the tasker commands`.

## Docs

- Update the docs in the same change as the code.
- Put a new command in `skills/tasker/SKILL.md` and in the `--help` output.
- Write the docs in plain English: short sentences, active voice, simple tenses, and "must" for a requirement.
- Do not use "should", "may", "might" or "could" in the docs.
- Use one word for one thing in each doc.
- In the docs, write the home folder as `$HOME`. Do not write `~` or an absolute path such as `/home/<user>`.

## AGENTS.md

- `AGENTS.md` is an index. Each line is a one-line description plus a link to the file that has the details.
- Do not put rule text in `AGENTS.md`.
- To add a topic, put its details in its own file under `docs/`. Then add one line to `AGENTS.md`.
- `CLAUDE.md` has one line, `@AGENTS.md`, and nothing else.
