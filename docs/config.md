# Configuration reference

tasker reads one JSON configuration file. Every tasker session on the machine shares this file.

## Where the file is

tasker looks for the file in this order and uses the first match:

1. The path in `$TASKER_CONFIG`.
2. `$XDG_CONFIG_HOME/tasker/config.json`.
3. `$HOME/.config/tasker/config.json`. This is the XDG default.

A variable that is empty or has only spaces counts as not set.

## Rules for the whole file

- Every object is strict. An unknown key is an error, also in a nested object.
- tasker reports all errors at once, not only the first one.
- A key marked "required" must be present. A key marked "optional" can be missing and has no default.
- A non-empty string is a string with at least one character.

## See the configuration with the defaults

Run `tasker show-config` to print the configuration as tasker reads it. The output has every default filled in and `dataRoot` expanded.

Run `tasker show-config --repo <key>` to print one repo.

If the configuration is invalid, the command prints the errors from the "Errors" section and exits with code 1.

## Top level

| Key                    | Type            | Default      | Notes                                                                                                                                                                                              |
| ---------------------- | --------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataRoot`             | string          | required     | The folder where tasker keeps its data. tasker expands a leading `~` and each `$NAME` or `${NAME}` first. The result must be an absolute path. A variable that is not set or is empty is an error. |
| `retentionDays`        | number          | `30`         | How many days tasker keeps data.                                                                                                                                                                   |
| `dataRootMinFreeBytes` | positive number | `1073741824` | The free space that `dataRoot` must have, in bytes.                                                                                                                                                |
| `limits`               | object          | required     | See [`limits`](#limits).                                                                                                                                                                           |
| `trackers`             | object          | `{}`         | Named issue tracker definitions that repos share. See [`trackers`](#trackers).                                                                                                                     |
| `repos`                | object          | required     | Maps each repo key to a repo. See [`repos.<key>`](#reposkey).                                                                                                                                      |

The file has no `landing` key. If it has one, tasker reports this error: `landing: is not accepted: there is no landing setting; the command you run picks how a task lands`.

## `limits`

| Key                   | Type            | Default  | Notes                                                |
| --------------------- | --------------- | -------- | ---------------------------------------------------- |
| `bootstrapTimeoutMin` | positive number | required | Minutes that the bootstrap phase can run.            |
| `verifyTimeoutMin`    | positive number | required | Minutes that the verify phase can run.               |
| `planTimeoutMin`      | positive number | `30`     | Minutes that the plan phase or a review run can run. |
| `executeTimeoutMin`   | positive number | `90`     | Minutes that the execute phase can run.              |

## `repos.<key>`

The key names the repo. It can contain `/`, for example `codeguru42/tasker`. An error path uses the key as it is.

| Key                      | Type                         | Default                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `remote`                 | non-empty string             | required                              | The remote address of the repo. Provision writes it as `remote.origin.url` of the bare clone on each run. For a relative local path, it writes the root of the file system followed by the path.                                                                                                                                                                                                                                                                                      |
| `issueTracker`           | object                       | required                              | See [`issueTracker`](#issuetracker).                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `assistant`              | object                       | required                              | See [`assistant`](#assistant).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `verify`                 | object                       | required                              | `commands`: list of non-empty strings with at least one item (required). The deadline is `limits.verifyTimeoutMin`. Each command has its own log. See [Phase commands](#phase-commands). `env`: list of names (default `[]`).                                                                                                                                                                                                                                                         |
| `bootstrap`              | object                       | `{ "commands": [], "env": [] }`       | `commands`: list of strings (default `[]`). The deadline is `limits.bootstrapTimeoutMin`. See [Phase commands](#phase-commands). `env`: list of names (default `[]`).                                                                                                                                                                                                                                                                                                                 |
| `defaultBaseBranch`      | non-empty string             | optional                              | The name of a branch on `origin` that tasks start from. tasker uses the value as it is and does not strip `origin/`. The form `refs/heads/<x>` fails with `repos.<key>.defaultBaseBranch: must name a remote branch, not a local branch in the form refs/heads/<x>`. tasker uses the value only when no default is learned for the repo. If the branch exists, tasker saves it as the learned default. If not, the resolve fails. See [workspaces.md](dev/workspaces.md#base-branch). |
| `overagePolicy`          | `"decline"` or `"ask"`       | `"decline"`                           | What a run does when its use of the quota gets high. Under `"decline"`, a run stops in `quota_blocked` when paid usage starts. Under `"ask"`, the task pauses in `awaiting_quota_approval` after a run whose use of the quota window reached `quotaApprovalThreshold`. Only the `claude-code` assistant reports quota events.                                                                                                                                                         |
| `quotaApprovalThreshold` | number above 0 and at most 1 | `0.9`                                 | The use of the quota window, as a share, at which the task pauses after a run under `overagePolicy: "ask"`.                                                                                                                                                                                                                                                                                                                                                                           |
| `updateBranchStrategy`   | `"rebase"` or `"merge"`      | `"rebase"`                            | How to bring a branch up to date.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `forge`                  | object                       | optional                              | See [`forge`](#forge).                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `vcs`                    | object                       | `{ "provider": "git", "config": {} }` | See [`vcs`](#vcs).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Phase commands

The lists `verify.commands` and `bootstrap.commands` run in the same way:

- Each command runs under `/bin/bash` in the worktree of the task.
- The commands run one at a time, in the list order.
- One deadline from [`limits`](#limits) covers the whole list. The row of each phase names its deadline.
- The first command that fails stops the list.
- Only the exit codes count.
- The output goes to the log of the phase, not to the terminal. [phases.md](dev/phases.md) describes the logs.

### `env` lists

`verify.env` and `bootstrap.env` name the environment variables that tasker hands to a phase. Each name must follow these rules:

- It matches `^[A-Za-z_][A-Za-z0-9_]*$`.
- It does not start with `TASKER_`. A `TASKER_` variable belongs to tasker and tasker never hands it to a phase.
- It is not a name that every phase already receives. Those names are:
  `PATH`, `HOME`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TERM`, `SHELL`, `TMPDIR`, `TZ`, `USER`, `LOGNAME`, `CLAUDE_CONFIG_DIR`, `NVM_DIR`, `ASDF_DIR`, `ASDF_DATA_DIR`, `VOLTA_HOME`, `FNM_DIR`, `N_PREFIX`, `PYENV_ROOT`, `RBENV_ROOT`, `SDKMAN_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`.

Tasker always drops `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the environment of a phase, also when a list names them.

## `issueTracker`

This table describes the object after tasker merges a named tracker into it.

| Key                    | Type                   | Default  | Notes                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`             | `"github"` or `"jira"` | required | The kind of tracker. When `tracker` is set, the provider comes from the named tracker. The `jira` tracker is not available in this version. The loader still accepts the value. When tasker picks the provider of a repo with `jira`, it reports `repos.<key>.issueTracker.provider: the jira tracker is not available in this version`. |
| `project`              | non-empty string       | optional | The project of the tracker. If it is missing, tasker uses the repo key.                                                                                                                                                                                                                                                                  |
| `match`                | object                 | optional | `labels`: list of non-empty strings with at least one item. `components`: list of non-empty strings with at least one item. The object must name `labels` or `components`.                                                                                                                                                               |
| `site`                 | non-empty string       | optional | The site of the tracker. tasker stores it in lower case.                                                                                                                                                                                                                                                                                 |
| `tracker`              | non-empty string       | optional | The name of an entry under `trackers`.                                                                                                                                                                                                                                                                                                   |
| `account`              | non-empty string       | optional | The account that tasker uses. The `github` tracker requires it, because tasker runs `gh` as this account. Without it, tasker reports `repos.<key>.issueTracker.account: is required for the github tracker`.                                                                                                                             |
| `releaseBranchFieldId` | non-empty string       | optional | The id of the field that holds the release branch.                                                                                                                                                                                                                                                                                       |
| `releaseBranchField`   | non-empty string       | optional | The name of the field that holds the release branch.                                                                                                                                                                                                                                                                                     |
| `updateOnStart`        | boolean                | `false`  | `tasker start` assigns the issue and marks it in progress after the task reaches `workspace_ready`. It refuses an issue that already has the in-progress marker unless you give `--reclaim`. A failed write only warns.                                                                                                                  |
| `assignee`             | non-empty string       | `"@me"`  | Who `tasker start` assigns the issue to.                                                                                                                                                                                                                                                                                                 |
| `inProgressLabel`      | non-empty string       | optional | The label that `tasker start` adds and checks for (`github`). With no label, the start only assigns the issue.                                                                                                                                                                                                                           |
| `inProgressStatus`     | non-empty string       | optional | The same as `inProgressLabel`, for `jira`, which is not available in this version.                                                                                                                                                                                                                                                       |
| `updateOnFinish`       | boolean                | `false`  | `tasker finish` marks the issue done after it removes the worktree and the branch. A failed write only warns, and the task still goes to `finished`.                                                                                                                                                                                     |
| `doneLabel`            | non-empty string       | optional | `tasker finish` adds this label, and the issue stays open. With no label, the finish closes the issue as completed.                                                                                                                                                                                                                      |
| `doneStatus`           | non-empty string       | optional | The same as `doneLabel`, for `jira`, which is not available in this version.                                                                                                                                                                                                                                                             |

## `trackers`

`trackers` maps a name to a tracker definition. A definition takes every `issueTracker` key except `project`, `tracker` and `match`. Its `provider` is required. A definition can leave `account` out, because each repo can set it.

A repo uses a definition when `issueTracker.tracker` names it. Then tasker merges the two:

- The keys that the repo sets win over the keys of the definition.
- The repo must not set `provider`. The provider comes only from the definition.
- If the name is not under `trackers`, tasker reports an error at `repos.<key>.issueTracker.tracker`.
- If the definition has an error, tasker reports it once, under `trackers.<name>`.
- tasker checks `account` on the merged `issueTracker` of each repo.

## `assistant`

| Key                 | Type                                   | Default  | Notes                                                                                                    |
| ------------------- | -------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `provider`          | `"claude-code"`, `"copilot"` or `"pi"` | required | The assistant to run. The loader accepts `copilot` and `pi`, but they are not available in this version. |
| `models`            | object                                 | required | Has the keys `plan`, `execute` and `review`. All three are required.                                     |
| `trustedExtensions` | list of non-empty strings              | `[]`     | The extensions that the assistant can trust.                                                             |
| `account`           | non-empty string                       | optional | The account to use.                                                                                      |
| `correctiveTurns`   | integer, 0 or more                     | `1`      | How many corrective turns the assistant can take.                                                        |

Each entry of `models` is an object with two required keys: `model` (non-empty string) and `effort` (`"low"`, `"medium"` or `"high"`).

The model and the effort of a role apply to new sessions only. A continued session keeps the provider, the model and the effort that it started with.

For the `claude-code` provider, `model` must have one of these forms:

- An alias: `sonnet`, `opus`, `haiku`, `opusplan` or `fable`.
- A full id: `claude-` followed by lowercase letters, digits, `.` and `-`. For example, `claude-opus-5-5`.
- Either form with the suffix `[1m]`. For example, `opus[1m]`.

Any other model gives the error `repos.<key>.assistant.models.<role>.model: is not a claude-code model: <value>`. The providers `copilot` and `pi` have no model check.

The command `tasker model` changes the model and the effort of one role in the file that "Where the file is" names. It keeps the other keys and their order. It writes an indent of two spaces and keeps the line end at the end of the file. It does not write the defaults. The command has two limits:

- Integer-like keys move to the front of their object, in number order.
- If a key appears twice in one object, the command keeps only the last copy.

## `forge`

| Key           | Type                                | Default   | Notes                        |
| ------------- | ----------------------------------- | --------- | ---------------------------- |
| `provider`    | `"github"`                          | required  | The kind of forge.           |
| `account`     | non-empty string                    | required  | The account to use.          |
| `mergeMethod` | `"merge"`, `"squash"` or `"rebase"` | `"merge"` | How to merge a pull request. |

## `vcs`

`vcs` selects the version control provider of the repo. It also holds the configuration of that provider.

| Key        | Type    | Default | Notes                                                             |
| ---------- | ------- | ------- | ----------------------------------------------------------------- |
| `provider` | `"git"` | `"git"` | The kind of version control. `"git"` is the only permitted value. |
| `config`   | object  | `{}`    | The configuration of the provider. The provider validates it.     |

For `"git"`, `config` takes these keys:

| Key           | Type             | Default  | Notes                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------- | ---------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorName`  | non-empty string | optional | The name of the author of a commit. Provision writes it as exactly one `user.name` line in the bare clone. If it is missing, provision writes nothing for it on a fresh clone and removes every local `user.name` line on a complete clone, and git uses the global identity.                                                                                                                   |
| `authorEmail` | non-empty string | optional | The email of the author of a commit. Provision writes it as exactly one `user.email` line in the bare clone. If it is missing, provision writes nothing for it on a fresh clone and removes every local `user.email` line on a complete clone, and git uses the global identity.                                                                                                                |
| `sshKey`      | non-empty string | optional | The path of the SSH key that git uses. Provision writes `core.sshCommand` in the clone (through the include file `tasker-ssh.config`) and sets `GIT_SSH_COMMAND` for each call to the remote. The command is `ssh -i '<key>' -o IdentitiesOnly=yes -o BatchMode=yes`. A key with a passphrase fails unless `ssh-agent` holds it. If it is missing, provision sets no ssh command for the clone. |

The key `repos.<key>.git` does not exist. tasker reports it as `repos.<key>.git: unrecognized key`. Put the git configuration under `vcs.config`.

## Errors

tasker reports each problem on its own line. A line has the dotted path of the key, a colon and a message. The first line says `Invalid configuration:`. For example:

```
Invalid configuration:
  - repos.tasker.verify.commands: Too small: expected array to have >=1 items
  - repos.tasker.verify.comands: unrecognized key
```

The message of a built-in check can differ from this example. The path always names the bad key. A problem with no key uses `(config)` as its path.

## Example

```json
{
  "dataRoot": "$HOME/.local/share/tasker",
  "limits": { "bootstrapTimeoutMin": 10, "verifyTimeoutMin": 20 },
  "repos": {
    "tasker": {
      "remote": "git@github.com:codeguru42/tasker.git",
      "issueTracker": { "provider": "github", "account": "codeguru42" },
      "assistant": {
        "provider": "claude-code",
        "models": {
          "plan": { "model": "opus", "effort": "high" },
          "execute": { "model": "sonnet", "effort": "medium" },
          "review": { "model": "opus", "effort": "high" }
        }
      },
      "verify": { "commands": ["npm run check"] }
    }
  }
}
```
