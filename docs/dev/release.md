# Releases

A version of tasker is a commit of `main` with the tag `v<version>`. The `version` in `package.json` at that commit is `<version>`.

## Why a version is a tag

The installed `tasker` runs the tickets of this repo. It must not change while a ticket runs. Only an install of a new version changes it. The steps of an install are in the [Install section of README.md](../../README.md#install).

## Make a new version

1. Change `version` in `package.json` in one commit on `main`.
2. Add the tag `v<version>` to that commit.
3. Push the tag.

## The npm facts

- Without a `files` list, npm leaves out each path of `.gitignore`. `dist/` is in `.gitignore`, so `package.json` has a `files` list.
- `npm pack` first deletes `dist/` and then runs `npm run build`, through the `prepack` script. As a result, `dist/` holds only the build of the commit that is checked out.
- `npm install -g` of a package file copies the files into the global folder of npm. A later change of the clone does not change the installed `tasker`.
