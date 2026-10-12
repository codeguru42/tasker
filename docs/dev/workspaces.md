# Workspaces

This page describes the base branch of a task. The code is in `src/vcs/git/base-branch.ts`.

## Base branch

No command calls the resolve yet. `tasker start` will supply `ask` and call it (M4). The blocker step for stacked tasks is not part of it (M13).

### Forms

The stored form of a base is one of these:

- `<x>` is a branch on `origin`.
- `refs/heads/<x>` is a local branch of the bare clone.

`parseBaseInput(input)` parses the text that a user types. This is the text of `--base` and the answer of `ask`.

| Input | Result |
| --- | --- |
| `origin/<x>` | `<x>` |
| `refs/remotes/origin/<x>` | `<x>` |
| `refs/heads/<x>` | `refs/heads/<x>` |
| any other text | the same text, as the name of an origin branch |

`parseBaseInput()` throws an `Error` in two cases:

- The input is empty, or the name after `origin/`, `refs/remotes/origin/` or `refs/heads/` is empty. The message is `the base branch is empty`.
- The text after `origin/` or `refs/remotes/origin/` starts with `refs/heads/`. The message is `the base branch is not a branch name: <input>`.

Names such as `-x` and `a..b` pass the parse. The existence check then rejects them, and its error names them.

### Revision

`baseRevision(base)` gives the git revision of a stored base. For `refs/heads/<x>` it returns the same text. For `<x>` it returns `refs/remotes/origin/<x>`, which is the remote-tracking ref of `origin/<x>`. The short name `origin/<x>` can name a stale local branch in the bare clone, so tasker uses the full ref.

### Existence check

A base exists when `git show-ref --verify --quiet -- <revision>` exits with 0. Exit code 1 means that the ref is missing. Every other error passes through unchanged.

### The resolve

`resolveBaseBranch()` takes these inputs: `repoKey`, `clone` (the bare clone of provision), `sshKey`, `env`, `memory` (the three store functions of [data-root.md](data-root.md#default_base_branches-table)), `ask`, and the optional `hint`, `explicit` and `defaultBaseBranch`. It runs these steps in order:

1. Make the checks that need no git. If `explicit` is set, run `parseBaseInput()` on it. If `hint` is the empty text, throw `the base branch of the issue is empty`. If `hint` starts with `refs/heads/`, throw `the base branch of the issue must name a remote branch: <hint>`. An input that fails a check causes no fetch and no write.
2. Fetch. Run `git fetch origin --prune` through `runRemoteGit()` (see [version-control.md](version-control.md#resolvebasebranch)). A failure passes through unchanged. The resolve then stores and deletes nothing.
3. Use the hint, when `hint` is set. tasker uses the text as it is and does not strip `origin/`. If the branch is missing, throw `the base branch does not exist on origin: <hint> (from the issue)`. Otherwise the source is `hint`.
4. Use the explicit base, when `explicit` is set. Only this step can give `refs/heads/<x>`. If the parsed value is missing, throw `the base branch does not exist: <parsed> (from --base)`. Otherwise the source is `explicit`.
5. Use the learned default of the repo. If `memory.getDefaultBaseBranch(repoKey)` gives a value that exists, the source is `learned`. If the value is missing, tasker calls `memory.forgetDefaultBaseBranch(repoKey, <value>)` and adds the note `the learned base branch <value> no longer exists on origin. tasker forgot it.` Then it skips step 6 and goes to step 7.
6. Use `defaultBaseBranch`, when nothing is learned and `defaultBaseBranch` is set. tasker uses the value as it is, as the name of an origin branch, and does not strip `origin/`. If the branch is missing, throw `the base branch does not exist on origin: <value> (from defaultBaseBranch)`. tasker does not call `ask` in this case and stores nothing. Otherwise tasker saves the value (see "Learned default"), and the source is `config`.
7. Ask. Call `ask()` and run `parseBaseInput()` on the answer. If the value starts with `refs/heads/`, throw `the base branch must name a remote branch: <answer>`. If the branch is missing, throw `the base branch does not exist on origin: <value> (from the answer)`. Otherwise tasker saves the value, and the source is `ask`.

The hint comes from the issue tracker. tasker treats it as untrusted text. No hint can reach `refs/heads/*` through the existence check, because the check uses `refs/remotes/origin/<hint>`, and `git show-ref --verify` matches only the exact ref.

### Learned default

The learned default is the row of the repo in the `default_base_branches` table.

- Steps 6 and 7 call `memory.setDefaultBaseBranch(repoKey, <value>)` after the branch exists in the clone. They add the note `tasker saved <value> as the default base branch of <repoKey>.`
- A hint result and an explicit result store nothing.
- A later resolve with no hint and no explicit base uses the learned value in step 5. As a result, tasker asks at most once for each repo, unless a learned value later stops existing.
- `forgetDefaultBaseBranch()` deletes the row only when its branch equals the given branch. A value that another process saved in the meantime stays.

### Side effects

- The fetch moves and prunes `refs/remotes/origin/*` in the clone. This also happens when a later step of the resolve fails.
- Step 5 deletes a learned value that is missing before `ask` runs. If `ask` or its check then fails, the learned value stays deleted.
- Steps 6 and 7 write the learned value after the branch exists in the clone.
- No step writes or deletes a git ref.

### Result

The resolve returns an object with these fields:

| Field | Content |
| --- | --- |
| `base` | The stored form of the base. |
| `revision` | `baseRevision(base)`. |
| `source` | `hint`, `explicit`, `learned`, `config` or `ask`. |
| `notes` | The notes of the resolve, in the order they were added. The list is empty when nothing happened. |
