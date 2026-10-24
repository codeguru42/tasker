# Set up a new machine

This page gives the steps to set up a new machine, so that an orchestrator session can run the tickets of codeguru42/tasker there. The operator is the person who sets up the machine. The operator does each step of this page. The local clone is `$HOME/src/mine/tasker`. The configuration file is the file of tasker that [docs/config.md](../config.md) describes.

## The tools

On 2026-10-18, the machine used Node 26.7.0, git 2.47.3, gh 2.101.0 and Claude Code 2.1.302.

1. Install git, gh, Claude Code and nvm.
2. Log in to gh as the account `codeguru42`: `gh auth login --hostname github.com --scopes project`. The scope `project` is for the project board. [The token scopes of docs/config.md](../config.md#token-scopes) give the scope that tasker needs. If a command of the project board fails for a missing scope, follow the fix in [The project board](issues.md#the-project-board).
3. Make sure that the ssh key of the account reaches `git@github.com`, because the remote of the repo uses ssh: `ssh -T git@github.com`. [Facts about outside tools](version-control.md#facts-about-outside-tools) gives the exit codes of this command. If the exit code shows a wrong key, fix the ssh key of the account. Then run the command again.

## The local clone

1. Clone the repo to the local clone: `git clone git@github.com:codeguru42/tasker.git $HOME/src/mine/tasker`. The orchestrator and its agents run git and `tasker` from this clone.
2. In the local clone, run `nvm install`, so that the clone uses the Node version of step 1 of [Set up a working copy](../../CONTRIBUTING.md#set-up-a-working-copy).
3. [The folder bullet of Limits](limits.md#limits) gives the place of the task worktree. Do not change the other entries of `$HOME/src/mine/tasker-worktrees/`. They belong to other work.

## The installed tasker

The orchestrator runs the tickets with the installed `tasker`, as [docs/dev/orchestration.md](orchestration.md) says.

1. Set up the configuration file:
   - Open the configuration file. [Where the file is](../config.md#where-the-file-is) gives its place.
   - If the configuration file does not exist, make it with the top-level keys of [the example of docs/config.md](../config.md#example), for example `dataRoot`, `skillsDirs` and `limits`.
   - Under `repos`, add this entry. In a new file, it is the only entry under `repos`:

   ```json
   "codeguru42/tasker": {
     "issueTracker": { "provider": "github", "account": "codeguru42", "updateOnStart": true, "updateOnFinish": true },
     "remote": "git@github.com:codeguru42/tasker.git",
     "defaultBaseBranch": "main",
     "bootstrap": { "commands": ["npm ci"], "env": [] },
     "verify": { "commands": ["npm run check"], "env": [] },
     "assistant": {
       "provider": "claude-code",
       "models": {
         "plan": { "model": "opus", "effort": "medium" },
         "execute": { "model": "sonnet", "effort": "medium" },
         "review": { "model": "opus", "effort": "medium" }
       }
     }
   }
   ```

2. Do the steps of [the Install section of README.md](../../README.md#install) in a clone of the operator, in a folder outside the local clone and outside `$HOME/src/mine/tasker-worktrees/`. The local clone must stay on `main`, because [the doc-read rule](doc-reads.md#the-doc-read-rule) fast-forwards `main` there. The rule does not run the merge when another branch is checked out in the local clone, and an agent then stops. Step 8 of that section runs `tasker install-skills`. That command copies the skills of the installed tasker into each folder of `skillsDirs`. These skills come from the folder `skills/` of the repo. That command needs the configuration file.
3. Run `tasker doctor`. It must pass. If a check fails, fix the cause that the check names. Then run `tasker doctor` again.
4. If the tasker clone does not exist yet, run `tasker start` for one issue first. Then, in the local clone, add the read-only `tasker` remote, as steps 1 and 2 of [docs/dev/rebase-conflicts.md](rebase-conflicts.md#procedure) say.

## Claude Code

The repo file `.claude/settings.json` needs no change, as [the plain-form rule](tasker-commands.md#the-plain-form-rule) says.

1. In `$HOME/.claude/settings.json`, set `permissions.defaultMode` to `"auto"`.
2. Add these rules to `permissions.ask`, so that the user approves each such command:
   - `Bash(tasker approve-credits)` and `Bash(tasker approve-credits *)`
   - `Bash(tasker abort)` and `Bash(tasker abort *)`
   - `Bash(tasker update-branch *--undo*)`
   - `Bash(git push --force*)`, `Bash(git push * --force*)`, `Bash(git push -f *)`, `Bash(git push * -f *)` and `Bash(git push * +*)`
   - Each git command that names the data root of the installed tasker, for example `Bash(git -C $HOME/.local/share/tasker/*)`, `Bash(git --git-dir $HOME/.local/share/tasker/*)`, `Bash(git --git-dir=$HOME/.local/share/tasker/*)`, `Bash(git --work-tree $HOME/.local/share/tasker/*)`, `Bash(git --work-tree=$HOME/.local/share/tasker/*)` and `Bash(cd $HOME/.local/share/tasker/repos/*)`
3. In each rule, write the absolute path of the home folder in place of `$HOME`.
4. Install the skill `simple-english` in `$HOME/.claude/skills/`.
5. Install the Claude Code plugin `superpowers`: `claude plugin install superpowers@claude-plugins-official`.
6. In `$HOME/.claude/CLAUDE.md`, add the line `activate simple-english in all sessions`.
