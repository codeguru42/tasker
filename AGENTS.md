# Rules for this repo

Each assistant session reads this file first. It gives the rules of the repo in a short form. The linked docs give the details.

## Docs

- [Code conventions](docs/dev/code-conventions.md): the layout, the steps to add a command, the imports and the tests.
- [Configuration reference](docs/config.md): the configuration.
- [Data root](docs/dev/data-root.md): the folders and the database.
- [tasker skill](skills/tasker/SKILL.md): the commands.

## Check

`npm run check` must pass before a change is complete.

## Rules

- Write the test first. Commit the failing test, then the code that makes it pass.
- Update the docs in the same change as the code.
- Put a new command in `skills/tasker/SKILL.md` and in the `--help` output.
- Put shared test helpers in `test/helpers.ts`. Do not copy a helper into a test file.
- Write the docs in plain English: short sentences, active voice, simple tenses, and "must" for a requirement.
- Do not use "should", "may", "might" or "could" in the docs.
- Use one word for one thing in each doc.
- If `tasker update-branch` reports a rebase conflict, follow [docs/dev/rebase-conflicts.md](docs/dev/rebase-conflicts.md).

## Commits

- Each commit subject starts with a conventional prefix.
- The commit subject of a failing test is `test: <subject>`.
- The commit that makes the test pass uses the same commit subject with `feat:` or `fix:`.
- A docs change uses `docs:`.
- A change with no new behavior uses `refactor:`.
- Write each commit subject in the imperative, with a capital letter after the prefix, for example `feat: Add show-config to the tasker commands`.
