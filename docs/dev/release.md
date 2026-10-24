# Releases

tasker has two kinds of version: a stable release and a pre-release.

A stable release is a commit of `main` with a tag. The tag is the version itself, with no prefix. The `version` in `package.json` at that commit is the same text as the tag. The form is `yyyy.m.d`, the date in UTC, with no leading zeros. Examples: `2026.10.24` and `2026.1.5`. A stable release is at most one release on each day.

A pre-release is a local build of any commit. It has no commit. It has a local tag only when the developer adds one, and that tag never goes to GitHub. The form is `yyyy.m.d-<commit>`, the date in UTC, with no leading zeros. `<commit>` is the output of `git rev-parse --short HEAD`. Example: `2026.10.23-c0c0d1a5`. With the commit in the version, `tasker --version` names the exact code that runs.

Both forms use UTC, so a version does not depend on the time zone of the operator.

tasker uses date versions on purpose and does not use semver (semantic versioning, a version number that shows which changes break the code of a user). Semver has no meaning for an application that a user runs. Semver is for a library, where the number tells the user of the library which changes break their code. The stable form has the shape of a semver version only because the npm registry needs that shape. The numbers are a date and give no semver meaning.

## Why the installed tasker does not change

The installed `tasker` runs the tickets of this repo. It must not change while a ticket runs. Only an install of a stable release or of a pre-release changes it. The steps of an install are in the [Install section of README.md](../../README.md#install). `npm run install:global` also runs `tasker install-skills`, because the skills describe the commands of one version.

## Make a stable release

Do these steps in the local clone, on `main`.

1. Fast-forward `main`: `git pull --ff-only origin main`.
2. Make the release commit and its tag: `npm version $(date -u +%Y.%-m.%-d) --tag-version-prefix= -m "chore: Release %s"`.
3. Push `main` and the tag: `git push origin main <version>`.
4. Install the release: `npm run install:global`.

The pre-release steps do not use `npm version`, because it makes a commit.

## Install a pre-release

A pre-release installs the commit that is checked out. Do these steps in the current clone, on the commit that is checked out, but never in a task worktree. The install replaces the installed `tasker` (see [Why the installed tasker does not change](#why-the-installed-tasker-does-not-change)).

For the HEAD of `main`:

1. Fast-forward `main`: `git pull --ff-only origin main`.
2. Optional: to give the install a version of your own, add a local tag on HEAD: `git tag <version>`. Without a tag, the script sets the version `yyyy.m.d-<commit>`.
3. Install the commit: `npm run install:global`.

For a commit that is not on `main`:

1. Check out the commit in the current clone.
2. Optional: to give the install a version of your own, add a local tag on HEAD: `git tag <version>`. Without a tag, the script sets the version `yyyy.m.d-<commit>`.
3. Install the commit: `npm run install:global`.

The pre-release tag stays local and never goes to GitHub.

## The npm facts

- Without a `files` list, npm leaves out each path of `.gitignore`. `dist/` is in `.gitignore`, so `package.json` has a `files` list.
- `npm pack` first deletes `dist/` and then runs `npm run build`, through the `prepack` script. As a result, `dist/` holds only the build of the commit that is checked out.
- `npm install -g` of a package file copies the files into the global folder of npm. A later change of the clone does not change the installed `tasker`.

Measured on 2026-10-24 with npm 11.19.0 and GNU date:

- `npm publish --dry-run` refuses `20261019.0100` and `20261019.010000-c0c0d1a5` with `npm error Invalid version`. It accepts `2026.1.5`.
- `date -u +%Y.%-m.%-d` prints the date with no leading zeros, for example `2026.10.24`.
- On a clone of tasker, `npm version 2026.10.24 --tag-version-prefix= -m "chore: Release %s"` changes only the three `version` fields in `package.json` and `package-lock.json`. It makes one commit with the subject `chore: Release 2026.10.24` and an annotated tag `2026.10.24`. The working tree stays clean.
- `npm pkg set version=<value>`, `npm pack` and `npm install -g` keep `2026.10.23-c0c0d1a5` and `2026.10.23-0123456` exactly as written. Only `npm publish` changes a leading zero in a number part of a pre-release (`2026.10.19-0123456` becomes `2026.10.19-123456`), and a pre-release never goes to the registry.
- semver sorts a pre-release before the stable release of the same day: `2026.10.23-c0c0d1a5 < 2026.10.23`.
