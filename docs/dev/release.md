# Releases

tasker has two kinds of version: a stable release and a pre-release.

A stable release is a commit of `main` with a tag. The tag is the version itself, with no prefix. The `version` in `package.json` at that commit is the same text as the tag. The form is `yyyy.m.d`, the date in UTC, with no leading zeros. Examples: `2026.10.24` and `2026.1.5`. A stable release is at most one release on each day.

A pre-release is a local build of any commit. It has no tag and no commit, and nothing goes to GitHub. The form is `yyyy.m.d-<commit>`, the date in UTC, with no leading zeros. `<commit>` is the output of `git rev-parse --short HEAD`. Example: `2026.10.23-c0c0d1a5`. With the commit in the version, `tasker --version` names the exact code that runs.

Both forms use UTC, so a version does not depend on the time zone of the operator.

tasker uses date versions on purpose and does not use semver (semantic versioning, a version number that shows which changes break the code of a user). Semver has no meaning for an application that a user runs. Semver is for a library, where the number tells the user of the library which changes break their code. The stable form has the shape of a semver version only because the npm registry needs that shape. The numbers are a date and give no semver meaning.

## Why a version is a tag

The installed `tasker` runs the tickets of this repo. It must not change while a ticket runs. Only an install of a stable release or of a pre-release changes it. The steps of an install are in the [Install section of README.md](../../README.md#install). After an update, run `tasker install-skills` again, so that the skills match the version, because the skills describe the commands of one version.

## Make a stable release

Do these steps on `main`.

1. Make the release commit and its tag: `npm version $(date -u +%Y.%-m.%-d) --tag-version-prefix= -m "chore: Release %s"`.
2. Push `main` and the tag: `git push origin main <version>`.

The pre-release steps do not use `npm version`, because it makes a commit and a tag.

## Install a pre-release

Do these steps in a clone of the operator, outside the task worktrees. The install replaces the installed `tasker` (see [Why a version is a tag](#why-a-version-is-a-tag)).

1. Make sure that the working tree of the clone has no changes. Step 7 runs `git checkout package.json`, and that command removes all changes to the file, not only the version.
2. Check out the commit: `git checkout <commit>`. It can be a commit of `main` or of another branch.
3. Install the dependencies: `npm ci`.
4. Set the version: `npm pkg set version=$(date -u +%Y.%-m.%-d)-$(git rev-parse --short HEAD)`.
5. Make the package file: `npm pack`.
6. Install the package file: `npm install -g ./tasker-<version>.tgz`.
7. Restore `package.json`: `git checkout package.json`.
8. Make sure that `tasker --version` prints `<version>`.
9. Run `tasker install-skills`.

## The npm facts

- Without a `files` list, npm leaves out each path of `.gitignore`. `dist/` is in `.gitignore`, so `package.json` has a `files` list.
- `npm pack` first deletes `dist/` and then runs `npm run build`, through the `prepack` script. As a result, `dist/` holds only the build of the commit that is checked out.
- `npm install -g` of a package file copies the files into the global folder of npm. A later change of the clone does not change the installed `tasker`.

Measured on 2026-10-18 and 2026-10-19 with npm 11.19.0:

- `npm version 20261019.0022` fails with `npm error Invalid version: 20261019.0022`. It fails the same way with `--no-git-tag-version`, and for the pre-release form.
- `npm pkg set version=<value>` accepts `20261019.0022` and `20261019.002216-00fed99`. It changes only `version`. It makes no commit and no tag.
- `npm pack` accepts these versions and makes `<name>-<version>.tgz`.
- `npm install -g` of that package file installs it. The installed `package.json` keeps the version text exactly as written.
