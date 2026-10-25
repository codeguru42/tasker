# First refine

This page lists the hints for the first refine of a ticket, sorted by the kind of ticket.
[orchestrator.md](orchestrator.md) defines the terms "ticket" and "agent", and
[Review findings](review-findings.md#review-findings) defines a loop. The first refine is the first `tasker refine` of
step 4 of [Run one ticket](run-one-ticket.md#run-one-ticket).

A hint states what to ask the plan for, and why. When the plan gets the hints in the first refine, the review does not
have to find them one loop at a time.

The agent gives each hint that fits its ticket in the first refine. The agent also gives each hint that fits a later
refine in the feedback of that refine, for example in a fix of a review loop. On #342 and #344, a later refine broke the
hint that starts "Ask the plan to write no claim about a count in new text". On #373, the fix of loop 1 moved the target
of "Without that", which broke the hint that starts "If a refine puts a new sentence in the middle of a paragraph", and
[the diff read](run-one-ticket.md#the-diff-read) found it. Each cost one loop. The drafter of an issue can put a hint in
the issue body ([planner.md](planner.md#the-body-of-an-issue)).

Before the agent gives a hint, it compares the hint with the Out of scope section of the issue. If the Out of scope
section excludes what the hint asks for, the agent does not give the hint, also when the hint fits its ticket. The
bullet "A hint of the orchestrator can resolve a conflict" of
["The prompt of an agent"](pick-the-tickets.md#the-prompt-of-an-agent) gives the same compare for the orchestrator.

## All tickets

- Name the shared test helpers of `test/helpers/` that the tests must use, and ask the plan to make each test call them.
  A local helper in a test file can call a shared helper, for example to fix the arguments of one `describe` block. It
  must not repeat the steps of the shared helper, for example a call of the same store function with its own default
  values. The review counts such a local helper as a copy (#127). A key of a change object that names the case of the
  test is not a repeated default, for example `failingCommand: null` for a failed run. On #220, a first refine read the
  ban on a repeat of the steps of the shared helper too widely. The fix cost an extra refine. Before a ticket adds a
  second test file of the same kind, move the shared setup into `test/helpers/` ([rules.md](rules.md#tests)).
- Ask the plan for the side effects of each fix before `tasker approve`. A fix can cause a new finding about its own
  side effect.
- If a ticket adds a small exported helper, ask the plan for each place that does the same job
  ([rules.md](rules.md#tests)).
- If a review or the diff read finds a duplication, ask the plan to search all of `src/` and `test/` for the same
  pattern, not only the files of the diff, and to fix every copy in the same refine. A copy can already be on the base
  branch, in a file that the ticket does not touch (#94). [Review findings](review-findings.md#review-findings) gives
  the duplication rule.
- If a review finding says that code crosses a module boundary, ask the plan to find each import across that boundary. A
  module boundary is the line between two folders of `src/`, for example `src/review/` and `src/plan/`. Such a finding
  can be an altitude finding, which names code at the wrong level, for example a general helper inside one command or
  one feature folder. Ask the plan to list each import from the other folder in the changed files, and to say for each
  one if it moves or stays, with the reason. Ask it to fix all of them in the same refine. On #153, the refine fixed
  only the one use that loop 1 named, and loop 2 found the next import from `src/plan/` in `src/review/`.
- If a function becomes the one home of a rule, the old callers use only its result
  ([the one-home rule](rules.md#code)).
- A ticket that adds a required option to a shared function breaks the callers that an earlier ticket landed. After the
  rebase, run `npm run check` and update those callers ([rules.md](rules.md#commits)).
- The prompts of the installed tasker tell the plan that a todo does not run `npm run check`. Say in the first refine
  that [the Check rule](rules.md#check) wins over those prompts. On #158, the plan asked about the conflict as an open
  question, and the answer cost an extra refine. The Check rule also wins for `npm run format:check`. On #417, plan v2
  left out `npm run format:check` with the reason "a todo runs no check of the whole repo", and it cost one more refine.
- In a docs ticket, ask the plan to run `npm run format:check`, not `npx prettier` ([the Check rule](rules.md#check)).
  The plans of #245 and #254 used `npx prettier`. A plan that runs `npm run format` and then `npm run format:check` is
  fine. On #266, plan v1 already used `npm run format`.
- In a ticket that changes code, ask the plan to run a test file with `npm test -- <file>`, not with `npx vitest run`
  ([the Check rule](rules.md#check)). On #428 (2026-10-25), plan v1 used `npx vitest run`.
- If a refine asks the plan to fix commits in place (a fixup commit and an autosquash rebase), give the base commit in
  the feedback. For a plain base, get it with `git merge-base HEAD origin/<base branch>` in a worktree of the task
  branch, as [the commit check](verify-failures.md#the-commit-check) does.
  [The broken-commit steps](verify-failures.md#the-broken-commit-steps) already rebase onto it for a verify failure. Ask
  the plan to rebase onto that commit, not onto `origin/<base branch>`, and to make sure after each rebase that the
  merge base did not change. `origin/<base branch>` can move in the local clone after `tasker start`, and a rebase onto
  it also moves the task branch onto the new base (#94). For a stacked task, give
  [the start base of the last read](review-findings.md#review-findings) in place of
  `git merge-base HEAD origin/<base branch>`. After `tasker update-branch`, the plan uses the new base commit that the
  refine of step 4 of [Run one ticket](run-one-ticket.md#run-one-ticket) gives, as
  [the broken-commit steps](verify-failures.md#the-broken-commit-steps) say. The plan does not ask the execute session
  for `git merge-base` against a local branch in the worktree of tasker. On #419 (2026-10-25), the local `main` of the
  clone of tasker was an old commit, and plan v6 used the base commit 9ce3caa9 for this reason. If `origin` holds the
  task branch from step 9 of [docs/dev/rebase-conflicts.md](rebase-conflicts.md), the agent does the pushed-branch rule
  of [the broken-commit steps](verify-failures.md#the-broken-commit-steps) after step 11 of that page, before each later
  `tasker update-branch`. The parent of a [stacked task](pick-the-tickets.md#the-stacked-ticket-rule) can land with
  changed commits before the task has a commit of its own. Then the push of step 9 of
  [docs/dev/rebase-conflicts.md](rebase-conflicts.md#procedure) puts a commit of `origin/<base branch>` on `origin`. In
  that case, each run of the pushed-branch rule deletes nothing, because the ancestor check of step 4 of the rule
  passes. On #426 (2026-10-25), the rule ran two times and deleted nothing.
- In a docs ticket where several commits change the same line, ask the plan for a fallback that makes one `docs:`
  commit. A fixup autosquash of such commits conflicts. On #253, the agent hit this conflict. If the task has one
  `docs:` commit, the feedback of a fix after a review can ask for `git commit --amend --no-edit`, with the base commit
  named. On #265, the amend kept one commit with no autosquash conflict. Do not ask for an amend when the task is the
  parent of a [stacked task](pick-the-tickets.md#the-stacked-ticket-rule). The amend rewrites the base of the stacked
  task. Ask for a new commit on top instead.
- If the feedback of a refine names the base commit of the task at `tasker start`, read it with `git fetch tasker` and
  then `git rev-parse --verify tasker/<task branch>` right after `tasker start`. Do not read it from the local `main`,
  because `main` can move after the start. On #150, the feedback said that `main` moved after plan v1, but the task had
  started on a later commit.
- A `git fetch` over ssh in the local clone can hang for many minutes. A `timeout` around a `git fetch` keeps it short.
  The ban on `timeout` of [the command rules](tasker-commands.md#the-command-rules) covers only a `tasker` command. On
  #327, one fetch hung 17 minutes, and the next fetch passed at once.
- `git merge-tree` of the tip of the task onto the base names more conflicting files than the rebase of the commits of
  the task alone. It is a rough read, not the list of the real conflicts. On #182, it named `docs/statemachine.md`, and
  the rebase conflicted in `docs/dev/tasks.md` only.
- If a change removes a state that the tests depend on, ask the plan to search the tests for it and to name each hit.
- An explicit option from the caller is better than a detection inside a general helper. A detection causes findings
  about dropped errors and about cost.
- If a review finding depends on the timing of the event loop, ask for a failing test first. If execute cannot make a
  test fail, dismiss the finding with the evidence from the local machine. The evidence is a loop of about 200 runs of
  that test. Such a loop finds a test that fails only sometimes. Before the dismiss, the agent runs the loop in the task
  worktree, as [the measure rule](run-one-ticket.md#the-measure-rule) does, after the npm ci bullet of
  [Limits](limits.md#limits). If the plan depends on the timing of the event loop, the agent runs
  [the fact test](plan-review.md#the-fact-test) two times. The agent gives both results in the first refine. One run
  starts the code in top-level code. The other run starts it inside a callback of the poll phase (the phase of the event
  loop that runs the callbacks of input and output), for example after an `await` of a file read. A real run of tasker
  starts its code in such a callback. On #224, one `setImmediate` turn passed in top-level code. Inside such a callback,
  on Node v26.7.0, one turn lost a SIGTERM that the process sent to itself 5 of 5 times. Two turns lost it 0 of 5 times.
  Review loop 1 of #224 found the case.
- If tests wait in a loop, ask for one shared wait helper.
- For a test on fake timers, ask for `vi.runAllTimersAsync()` and not a helper that moves the clock a fixed amount. On
  #223, such a helper drew a finding about a false comment.
- If the tests compare the literal text of a default fixture, ask the plan for one shared expected-text helper in
  `test/helpers/`. On #157, [the diff read](run-one-ticket.md#the-diff-read) found the text of the default review
  findings copied in 4 test files, after a review with no findings.
- If a ticket adds a store table that more than one test reads, ask the plan for a shared read helper in
  `test/helpers/store.ts`, as `eventsOf` and `quotaEventsOf` do. On #28, a review with no findings left a repeated read
  of the new `quota_events` table in several test files:
  `withDataRootStore(dataRoot, (store) => store.listQuotaEvents())`. The diff read found it, and one more round added
  `quotaEventsOf`.
- For a test of a folder that cannot be written, use a path under a plain file. A write to such a path fails with
  `ENOTDIR` for each user, also root. A folder with `chmod 0555` stops a write only for a user that cannot write
  everywhere. On #316, the test needed this.
- If a new sentence makes an exception to an earlier clause, the exact text says which one wins. For example, the
  dead-code rule of [rules.md](rules.md#code) keeps a function for a later ticket "also as an unused export" (#124).
- An issue can give a rule and a fallback in two sentences, for example "the rows do not overlap", and then "if two rows
  overlap, name the row that wins". Ask the plan to mark the fallback with a word such as "still". Then the review reads
  one rule with a fallback, not two rules that do not agree. On #357, the review read the two sentences as two rules.
- If the issue gives the words of a scope exception, ask the plan whether the exception covers a bullet or a sentence.
  On #226, "except where a bullet names the planning session" can take the whole
  [draft-first rule](issues.md#before-a-post) away from the other sessions.
- Ask the plan to add no reason that the issue does not give. On #121, a reason clause that the plan added on its own
  drew a contradiction finding. Also ask the plan to add no reference that the issue does not name. This hint settles a
  plan question about the scope of a new rule. On #259, the plan then did not name `docs/dev/orchestration.md`. When the
  first refine gives this hint, it also names each link that [the one-home rule](rules.md#code) asks for. It also names
  each link to the home of a term that the issue uses, for example [the fact test](plan-review.md#the-fact-test). Such a
  link is not a reference that the hint bans. On #402, plan v2 dropped a link that the one-home rule needs, because the
  first refine gave this hint. On #432 (2026-10-25), refine 1 removed the link to the home of "fact test", because the
  first refine gave this hint. Review 1 asked for the link again, refine 4 added it again, and this cost one review
  loop.
- If an issue gives a reason in an example, ask the plan to compare that reason with the docs.
  [The body of an issue](planner.md#the-body-of-an-issue) asks the planner for the same compare before the post. If no
  doc supports the reason, ask the plan to drop it from the example. On #265, the Summary of the issue gave the reason
  "an agent changes only its own task". The plan copied it into the example, and review 1 found it.
- A condition of the issue that now holds is not a difference, for example "After #199 lands" when #199 is closed. Say
  this in the first refine. On #204, plan v1 called such a condition a difference.
- After [a change of scope](plan-review.md#the-stop-rule), compare the hints of the earlier refines with the new text
  before the next refine. On #198, a hint of the first refine had removed a sentence that the change-of-scope comment
  later required.
- If the plan copies issue text, ask the plan to rewrite each word that the simple-english skill bans
  ([rules.md](rules.md#docs)). Examples are "should" and "could". On #120, the plan copied "could" from the issue, and
  four reviews missed it. Ask the plan to run step 4 of the self-check of the simple-english skill over its text, not
  only a search for "should", "could" and "might". On #369, the word read missed "checks" as a verb, and it cost one
  refine before `tasker approve`. Step 4 of the self-check replaces the words "config", "settings" and "options" with
  "configuration". As a result, a hit of step 4 counts only in the meaning of the configuration. The word "option" in
  the meaning of a choice is not such a hit. On #435 (2026-10-25), the plan changed the word "option" of the issue to
  "choice". The change fit there, because the section already used "choice" for the same meaning. The skill also bans
  the present perfect and the past perfect, for example "has ended" and "had ended". Of the perfect forms, the search of
  step 2 of the self-check finds only "has been" and "have been". As a result, ask the plan to read each "has", "have"
  and "had" of the copied text. If the issue uses a perfect form, ask the plan for one plain term in its place. Ask the
  plan to use that term in each place of the form. A term that a doc defines stays as it is, for example "An agent has
  ended" of "Terms" in `docs/dev/quota.md`. Ask the plan to make sure that the plain term keeps the meaning of the
  issue. On #440 (2026-10-25), the first plain term "no longer runs" also covered "not started yet", and that changed
  the rule. Review 1 found the gap as [a design gap](plan-review.md#the-design-gap-rule).
- Ask the plan to start each item of a vertical list with an uppercase letter, as the simple-english skill says
  ([rules.md](rules.md#docs)). On #227, plan v4 had list items with a lowercase start, and one more refine fixed them.
- Ask the plan to count the sentences again after each split of a sentence for the word limit of the simple-english
  skill. The plan compares the count with each requirement of the issue that sets a count, for example "in one
  sentence". On #432 (2026-10-25), the split of a sentence of 29 words made an example three sentences, but the issue
  asked for one or two. This cost one more refine before `tasker approve`.
- In a doc step, ask the plan to write a function name without its arguments, for example `doctorChecks()`, not
  `doctorChecks(repos)`. [rules.md](rules.md#docs) counts the arguments of a function as a repeat of the code. On #266,
  the trim of the sentences that repeat the code found such a step.
- A check of the docs in the plan must not write a file to the folder of the agent. The folder bullet of
  [Limits](limits.md#limits) names that folder. Process substitution, for example `diff <(cmd1) <(cmd2)`, needs no file.
  On #115, a plan step wrote a temporary file to the folder of the agent.
- If the ticket derives a name from a key, for example a session name from an issue key, say that a collision of derived
  names is not an issue ([Core features first](working-with-the-user.md#core-features-first)). Otherwise the plan raises
  the question (#115).
- If a plan step or a doc step points to a report, link to the item of the report, not to the step as a whole. On #120,
  a link to a step as a whole drew a finding.
- A hint or a sentence that names a step also names the page of the step, for example "step 8 of
  [Run one ticket](run-one-ticket.md#run-one-ticket)". On #309, plan v1 copied the bare words "the refine of step 8"
  from the issue, and review 1 found them.
- If a plan searches for the callers of a function, ask it to search each form of a use, not only `name(`. Examples are
  an import, a pass as a value, for example `map(name)`, and a call through another name. On #122, a search for `name(`
  missed callers, and a review loop found them.
- In `grep -E`, write `|` for an alternative, not `\|`. In an extended regular expression, `\|` matches a literal bar.
  On #266, a search with `\|` found neither of two functions that exist.
- If the work of [the add-work rule](run-one-ticket.md#the-add-work-rule) adds tests and code, ask the plan for a
  `test:` commit and then a `feat:` or `fix:` commit, as [Tests](rules.md#tests) and [Commits](rules.md#commits) of
  rules.md say. On #122, the work of the add-work rule put both in one commit.
- A change of only help text and comments adds no behavior. Its prefix is `refactor:`, as [Commits](rules.md#commits) of
  rules.md says. On #346, a refine gave such a change the prefix `fix:`, and one more refine fixed it.
- If the plan depends on a fact about a program on the local machine, for example the behavior of `claude` under a
  permission mode, measure the fact and give it in the first refine with the command and its result
  ([the fact test](plan-review.md#the-fact-test)). On #128, the plan session tried to get such a fact itself, outside
  the worktree. Ask the plan to add no test that the issue or [Tests](rules.md#tests) of rules.md does not ask for. A
  fact test is the work of the agent, in [the folder of the agent](limits.md#limits) or in the task worktree, before the
  refine, and never a todo of the plan. On #425, plan v1 added the guard test `test/package-version.test.ts`, and it
  gave the execute session the fact test `npm pack` in the worktree of tasker. Refine 1 removed both.
- If a ticket adds a security check of a path for an outside tool, the real path can disagree with the tool. An example
  is a hook of `claude`. In each [diff read](run-one-ticket.md#the-diff-read), the agent also runs the real tool end to
  end with the built code of the task. The agent runs it in the task worktree, in the same way as
  [the measure rule](run-one-ticket.md#the-measure-rule). If the run finds a gap, the agent adds the work with
  [the add-work rule](run-one-ticket.md#the-add-work-rule). Also ask the plan for a check on the text of the path, not
  on the real path. The check on the text denies each symbolic link and each `.` or `..` part. The reason: such a check
  needs no real path, so the text of the path and the path that the kernel writes cannot disagree. On #430 (2026-10-25),
  an end-to-end run of the real tool with the built hook found more than the unit tests. The first hook of #430 used a
  check on the real path. In review loop 1, the rule had a gap with a symbolic link to a path that does not exist.
  Review loop 3 found that the text `..` and the kernel read of a symbolic link disagree. The user then changed the rule
  to a check on the text.
- If a ticket depends on the loaded copy of a skill that the agent must not run, the agent measures which copy loads. An
  example is a skill that writes memory, which [Limits](limits.md#limits) bans for an agent. The agent uses a scratch
  run of `claude -p` in a scratch repo that starts no skill. The hint that starts "For
  [a fact test](plan-review.md#the-fact-test) in a scratch repo" gives the folder. The prompt asks the session to list
  the descriptions of its skills and to run no skill. The run uses
  `--model haiku --max-turns 1 --disallowedTools Bash Write Edit`. A control skill that only the scratch repo holds
  shows that the run reads the skills of the scratch repo. On #413 (2026-10-25), with Claude Code 2.1.310, a copy was in
  the scratch repo and a copy was in `$HOME/.claude/skills/`. Claude Code loaded the copy in `$HOME/.claude/skills/`.
- If a ticket depends on a `SessionEnd` hook, the agent measures the hook with `claude -p` in a scratch repo. The hint
  that starts "For [a fact test](plan-review.md#the-fact-test) in a scratch repo" gives the folder. A project hook for
  `SessionEnd` in the scratch repo logs its input. The agent first runs
  `claude -p "<prompt>" --model haiku --max-turns 1`. Then `claude -p --continue "/clear" --model haiku --max-turns 1`
  runs the hook `SessionEnd` with `"reason":"clear"`. The transcript file still exists when the hook runs. The agent of
  #413 measured this on 2026-10-25, with Claude Code 2.1.310. On #413, this fact test showed that a reason of the issue
  was false. The issue said that Claude Code has no hook that runs before `/clear` with the transcript still there.
- If [a fact test](plan-review.md#the-fact-test) takes more than 30 minutes, the agent starts it in the first tool call
  of the work. The agent gives its result in the comment of step 11 of
  [Run one ticket](run-one-ticket.md#run-one-ticket). On #252, the result of a 40-minute test came after the landing.
- For [a fact test](plan-review.md#the-fact-test) in a scratch repo, make a new folder inside
  [the folder of the agent](limits.md#limits) with `mkdir`. Start each command in that folder as
  [the fact test](plan-review.md#the-fact-test) says. Do not clear a folder with `rm -rf`. On #231, a Bash call with
  `rm -rf` drew a permission prompt. The same test in a new folder ran with no prompt.
- If a script for [a fact test](plan-review.md#the-fact-test) in [the folder of the agent](limits.md#limits), outside
  the repo, uses top-level `await`, give the script the extension `.mts`. No `package.json` in that folder sets
  `"type": "module"`. As a result, `tsx` builds a `.ts` file there as CommonJS and refuses top-level `await`. On #225,
  `tsx` refused such a `.ts` script, and the same script ran as `.mts`.
- For [a fact test](plan-review.md#the-fact-test) about `grep`, call `/usr/bin/grep`. In the Bash tool of an agent,
  `grep` is a shell function that runs `ugrep`, not GNU grep. On #280, the agent measured its pattern with GNU grep
  3.11.
- To read a value in a scratch test, for example the real error of a git command, write the value to a file in
  [the folder of the agent](limits.md#limits), for example with `appendFileSync`. On #287, the output of `console.log`
  in a scratch test did not show in the output of `npm test`. The write to a file showed the error.
- [A fact test](plan-review.md#the-fact-test) tests the exact assertion of the plan, not only the text of the doc. On
  #137, `toEqual([input])` failed, because zod removes the unknown keys before the schema runs `refine()`.
- To measure a `gh` write with no call to GitHub, run `gh` against a fake local HTTPS server. Set `SSL_CERT_FILE` and
  `GH_ENTERPRISE_TOKEN`. Name the host of the server in the repo of the command, for example
  `gh issue edit 7 -R localhost:8444/owner/repo`. Give `GH_CONFIG_DIR` and `XDG_CACHE_HOME` folders of their own,
  because `gh` caches GraphQL answers. The agents of #63 and #236 used this.
- `gh api -i <path>` prints the header `X-Accepted-OAuth-Scopes` from a GET alone. The header gives the scope that the
  call needs. The output holds no token. The agent of #317 used this.
- In a feedback text, name a file [outside the worktree](plan-review.md#the-repo-files-rule) only as "a file outside the
  worktree". On #252, refine 1 named the location of such a file, the plan copied the name, and refine 2 had to remove
  it.
- If the issue gives the exact form of an entry, for example an index entry of `AGENTS.md`, say "no other words after
  the colon" in the first refine. Otherwise the plan adds a lead-in, as other entries have. On #151, this cost one
  refine.
- Before the agent dismisses a finding about the text of a message, it makes sure that the text is true for that case. A
  false message is a bug, not an edge case that [Review findings](review-findings.md#review-findings) lets the agent
  dismiss. On #132, the agent first dismissed such a finding as an edge case. The error named a log file that does not
  exist, for a command that the deadline kept from its start.
- If a shared rule names several options, ask the plan to make sure that the rule is true for each one. On #213, "the
  command uses the newest item" was false for `--command` of `show-verify`.
- Before the agent acts on a finding about a missing check, it looks for the check in the shared steps that the code
  calls. On #160, review 2 said that the feedback form had no check of the base revision. But the shared refine step
  already did that check before any write.
- A finding about a test gap that names two values needs a scratch check of each value. On #47, plan v5 covered only the
  remote.
- A refine can ask for a check that throws for a value that the code always has. Such a check cannot fail, and the
  dead-code rule of [rules.md](rules.md#code) bans it. Point the plan to the existing form, for example `feedback!` in
  `runResumed()`. On #347, such a check cost one refine before `tasker approve`.
- If a docs todo asks for reasons, give the plan the reasons that the issue lists. Then the session writes the reason,
  not only the rule. On #131, the first plan gave only the rules, and the diff read had to ask for the reasons again.
  Ask the plan to copy each reason text of the Docs section of the issue word for word. If such a reason text holds a
  word that the simple-english skill bans, the hints that start "If the plan copies issue text" and "If the issue gives
  a reason with a condition" still apply. On #425, review 1 had no findings, but the plan changed a reason into a
  sentence with the banned modal "would" in `docs/dev/release.md`. [The diff read](run-one-ticket.md#the-diff-read)
  found it, and the fix cost one loop of [the add-work rule](run-one-ticket.md#the-add-work-rule).
- The red `test:` commit ([rules.md](rules.md#commits)) of a new store method changes only test files and fails the type
  check, as in commit `97e8d2f`. Say this in the first refine. On #130, this kept the todo of the red commit clear.
- In a ticket that adds a method to an interface, tell the plan that the red `test:` commit
  ([rules.md](rules.md#commits)) can need one `// eslint-disable-next-line @typescript-eslint/no-unsafe-call` comment.
  The comment goes on the line that calls the new method. Without the comment, `npm run lint` fails, because the method
  does not exist yet. The `feat:` commit removes the comment. On #26, the `test:` commit `01704bf5` had this comment,
  and the `feat:` commit `254d65e5` removed it.
- If a case cannot happen in a real run, ask the plan to test it through the function that builds the result or the
  message, not through a real run. On #132, a command that the deadline keeps from its start cannot occur in a real
  verify run. The reason: a command that runs at the deadline gets SIGTERM and is itself the failing command.
- In the diff read, also search for doc sentences that a new shared helper made false. The search follows
  [the doc-search rule](rules.md#docs). On #133, a new shared read helper changed an error text, and the diff read found
  two doc sentences that it made false. On #132, the helper-name search of
  [the diff read](run-one-ticket.md#the-diff-read) found a copied test helper after a review with no findings.
- In [the diff read](run-one-ticket.md#the-diff-read), read each sentence that starts with "The reason:" together with
  the sentence before it. Make sure that the reason argues for that sentence, not against it. On #422 (2026-10-25), the
  diff read found a reason that the diff of #422 itself put in [the overlap rule](land-the-work.md#the-overlap-rule) of
  `docs/dev/land-the-work.md`. The reason stood right after the fallback sentence, which takes the files of a task from
  its plan when the branch diff is empty. The reason argued against that fallback. No review reported it.
- To find a copied test helper, search the exact form of a mapping step, for example `({ name, required, timeoutMs })`.
  On #47, this search found a copy after a review with no findings.
- Read the doc diff right after `tasker execute`, before the first review. Then a fix of a copied rule, or of a reason
  that the issue does not give, goes into the refine of loop 1. On #158, the first docs todo copied a shared rule and
  added reasons, and the review did not find them.
- After `tasker execute`, read the bytes of each test string outside ASCII, for example with `grep -P "\x{212A}"`. On
  #61, the execute session wrote a raw Kelvin sign in place of the escape.
- In [the diff read](run-one-ticket.md#the-diff-read), do not filter the diff with a pattern such as
  `grep -v '^[-+][-+]'`. A changed bullet line of a doc starts with `+-` or `--`, so the filter also drops it. Read the
  full diff. On #208, the agent found this, and the orchestrator hit it again on the same day.
- If [the diff read](run-one-ticket.md#the-diff-read) finds small work and the ticket must wait under a landing order,
  the agent adds the work before the wait. On #221, the fix landed in the loop before the wait. The review after
  `tasker update-branch` then had nothing new to find.
- For a [stacked task](pick-the-tickets.md#the-stacked-ticket-rule) whose parent is in `landed` while plan v1 is under
  review, wait for the close of the issue of the parent. Then run `tasker update-branch` before the first refine. A
  refine before the update costs one more refine, because the update marks the plan as stale
  ([the facts of the installed tasker](tasker-commands.md#the-facts-of-the-installed-tasker)). On #247, the wait took
  about 2 minutes.
- The agent of a [stacked task](pick-the-tickets.md#the-stacked-ticket-rule) runs
  `git merge-base --is-ancestor tasker/<parent branch> tasker/<task branch>` before each command that depends on the
  parent. These commands are `tasker refine`, `tasker approve` and `tasker execute`, not only the first refine. Before
  the check, the agent runs `git fetch tasker`. Exit code 1 means that the branch of the parent holds a commit that the
  task branch does not hold. Then an update moves the head. [The base rule](run-one-ticket.md#the-base-rule) says where
  the agent meets a landed parent at `tasker verify` and at `tasker refine`. The parent can land while the task is in
  `approved`. If the check then exits with 1, the agent runs `tasker execute` first. Then it runs `tasker update-branch`
  from `executed`, where the task stays in `executed`. An update from `approved` that moves the head demotes the task to
  `awaiting_plan_review` and costs a refine. The bullet of [Land the work](land-the-work.md#land-the-work) for a stacked
  task in `approved` gives the case where the head does not move. On #347, lesson 1 of the final report gave the
  demotion. On #346, the agent ran the update from `executed` after #47 landed. If the check exits with 1 in
  `awaiting_plan_review`, the agent runs `tasker update-branch` before the refine, because the update marks the plan as
  stale ([the facts of the installed tasker](tasker-commands.md#the-facts-of-the-installed-tasker)). If the check exits
  with another code, for example 128 for a pruned parent ref, the agent [stops](limits.md#the-answer-wait-rule) and
  reports the error. On #356, review 2 asked for both cases.
- A docs ticket with a stacked parent can need one spare review loop. After the parent lands, `tasker update-branch`
  moves the task onto `main`. If the changed lines change in the move, for example in a rebase conflict, the review
  after the move counts as a loop ([Review findings](review-findings.md#review-findings)).
- The review of a [stacked task](pick-the-tickets.md#the-stacked-ticket-rule) also reviews the lines of its parent. The
  agent compares each finding with the diff of the task branch against its start base.
  [The same-patch rule](review-findings.md#review-findings) defines the start base. A finding on a line of the parent is
  outside the issue, and the agent dismisses it with that reason. On #271, three of the four findings of review loop 1
  were about the text of #270.
- If a new search hit adds a file that the issue does not list under Docs, compare that file at once with the plans of
  the tasks in flight. On #168, a new hit added `docs/dev/phases.md`, and a task of another milestone also changed that
  file.
- If a plan rewrites a sentence, ask the plan to keep the scope of each example and to add no reference that the old
  sentence does not name. On #168, one rewrite used "that rule" with no rule named before it. Another rewrite widened
  the example `HEAD` to "such a base".
- To add a new rule for a session, ask for "The session also follows X", not "X also covers Y". The second form can
  claim too much about X. On #242, the agent learned this.
- If a refine removes a bullet of a list, ask the plan to read the lead-in sentence of that list again. On #215, a
  refine removed bullets of "Shared errors" in `skills/tasker/SKILL.md`. The lead-in sentence of the section then became
  false. The diff read found it before the first review.
- A list can hold bullets that point to "the bullet before this one", for example in
  [The body of an issue](planner.md#the-body-of-an-issue). Before a ticket inserts a bullet into such a list, the first
  refine names each such pointer and asks the plan to keep each one true. On #357, the new bullet went into such a list.
- If a refine puts a new sentence in the middle of a paragraph, ask the plan to read the sentences around it again. On
  #238, the agent learned this. A new sentence in the middle of a short section can also change what an "it" in the next
  sentence points to. On #244, review 1 found this in "Milestones" of `docs/dev/issues.md`: after the new sentence,
  "Then it runs `gh api`" pointed to the orchestrator. If a refine moves the sentences of a paragraph, ask the plan to
  read again each sentence that starts with a word that points back. Examples are "Otherwise" and "Without that". After
  the move, such a sentence can attach to the wrong condition. On #431, review 3 found this.
- If a refine removes a name from a list inside a sentence, ask the plan to fix the "and" of that sentence. Also ask it
  to search each doc for the same list. The search follows [the doc-search rule](rules.md#docs). On #20, a refine
  removed a name from a list, and the other docs with the same list kept the old "and".
- If a ticket writes files across the whole repo, for example a format run or a rename in each file, ask the plan to
  leave out the folder `.claude/`. The execute session cannot write some files under `.claude/`, for example
  `.claude/settings.json`. On #148, the format run left `.claude/settings.json` as it was, and the first `tasker verify`
  failed on it. The Write tool and the Edit tool of the execute session can write under `.claude/skills/`. Each other
  path under `.claude/` stays blocked for them, and the shell cannot write under `.claude/skills/` (see
  [the execute role](assistants.md#the-execute-role)). On #413, the Write tool refused
  `.claude/skills/session-review/SKILL.md`, and the task failed in `executing`.
- If two test helpers share a one-line rule, for example a PATH prefix, ask the plan to put the rule in one shared
  helper up front ([rules.md](rules.md#tests)). On #43, a new git wrapper helper copied the PATH rule of a sibling
  helper, and review 1 found the copy. The fix cost one loop.
- Ask the plan to write no claim about a count in new text, for example "two functions fetch". Such a claim becomes
  false with each new case. On #199, the fix of a count drew a new finding in the next loop.
- If the issue gives a `gh issue list` command, ask the plan to add `--limit 1000`. By default, gh lists at most 30
  issues (#200). [The priority rule](pick-the-tickets.md#pick-the-tickets) of `docs/dev/pick-the-tickets.md` holds such
  a command.
- If a page has two headings with the same name, the issue gives the exact anchor (#194).
- If an issue asks for a heading "next to a bullet", ask the plan to put the heading after the bullet list, not inside
  it. On #230, the orchestrator gave this answer before `tasker approve`.
- If an issue says that link text "is the issue key", ask the plan which form of the key it uses. A short form of the
  key can differ from the full key. On #230, the agent found this.
- In step 7 of [the rebase-conflict procedure](rebase-conflicts.md#procedure), resolve only the conflict hunk.
  `git checkout --theirs <file>` takes the whole file. On #201, it dropped a word that another ticket had added. A
  script for the conflict chains its steps with `&&`, so that a failed step stops the script (#201). If two tickets each
  add an import line to the same file of `test/helpers/`, the conflict is in the import lines. The fix keeps both
  imports.
- Run `git merge-base --is-ancestor` in its own command, or read its exit code right after it. In a chain with `&&`,
  `grep -c` exits with 1 for a count of 0, and the chain stops there. The exit code that the agent reads then belongs to
  `grep`. On #267, the agent ran [the ancestor check](rebase-conflicts.md#the-ancestor-check) a second time alone, and
  it passed.
- If the issue puts a command out of scope, ask the plan not to edit the docs of that command. On #159, the plan
  narrowed a reason sentence in the "Retry" section of [tasks.md](tasks.md#retry). Review 1 read the new sentence as a
  promise of a case that the ticket did not build.
- A link must support the exact sentence that holds it. Ask the plan to compare each link sentence with its target, for
  example "X says that Y". The target must say Y. On #159, a link sentence claimed more than its target doc says.
  [The diff read](run-one-ticket.md#the-diff-read) found it after execute. On #212, the compare found a real gap before
  execute, because [docs/config.md](../config.md#assistant) names the provider `claude-code`, not the `claude` command.
- If a plan rewrites "the test X fails when ..." into "X enforces these rules", ask the plan for one sentence for each
  test, with only the rule that the test enforces. On #266, plan v1 said that two tests enforce a rule that no test
  enforces.
- If the issue asks a lead-in to give some facts, make sure first that a linked section does not already give them. On
  #190, the lead-in repeated three facts of [the commit check](verify-failures.md#the-commit-check), and review 1 found
  the copy.
- If a change makes an argument optional, ask the plan to list each doc sentence that depends on that argument, and to
  say for each one if it changes. On #159, the feedback of [`tasker refine`](tasks.md#refine) became optional. Review 2
  found the sentence "a left-out question counts as answered by the feedback".
- If a ticket adds an option that takes numbers, name the raw-string rule to the plan. The comment of the helper that
  reads whole-number options in `src/commands/shared.ts` gives the rule: an error prints the value as the user typed it.
  On #158, review 1 found that a very large `--finding` position printed a changed number.
- Before the plan adds a test helper, ask it to search `test/commands/`, `test/tasks/` and `test/helpers/` for a helper
  that does the same job. On #178, one shared check of a refused command replaced three local copies.
- The rule of [Tests](rules.md#tests) on shared test helpers also covers a one-line wrapper around a shared helper. The
  second copy of such a wrapper is a duplication. On #179, three such wrappers cost one review loop.
- If a command has a failure path that ends in a state other than `failed`, ask the plan to give the shared failure step
  of `src/tasks/` the target state as an argument. On #180, the catch block of `finish` copied the steps, and the review
  found the copy.
- In a ticket that adds a command to the table of `src/state/commands.ts`, the rows of the command land in the same
  implementation commit as the registration of the command. Otherwise the test that each row names only a command that
  `tasker --help` lists fails in each implementation commit between the two. On #273, the execute session split the rows
  and the registration, and `tasker verify` failed.
- A `test:` commit that changes a shared test helper of `test/helpers/` also changes the test file of that helper,
  `test/helpers/<name>.test.ts`. In the first refine, name the test file of each helper that the plan changes. On #273,
  the session changed the expected rows in `test/helpers/state-commands.ts` and left the literal expectations in its
  test file. As a result, six tests failed at each implementation commit.
- If a shared step prints a next command, for example "run tasker resume", ask the plan to print it after the last check
  of the caller that can still change the state of the task. On #173, the shared result step printed "run tasker resume
  <issue key> to continue", and then the push guard of `tasker execute` moved the task to `failed`, where resume
  refuses.
- If a refine removes the first sentence of a paragraph, the feedback gives the new lead-in of that paragraph. On #173,
  a doc fix removed the first sentence of a paragraph in `docs/dev/tasks.md`, and the paragraph lost its subject.
- A test with one case is a plain `it`, not an `it.each`. On #262, a review flagged an `it.each` with only one case.
- [The orchestration pages](orchestrator.md) describe the installed tasker. A plan for a change of the tasker that this
  repo builds does not edit them. On #278, plan v2 added a todo for `docs/dev/orchestration.md`, and the agent took it
  out.
- If a label does not exist, `gh issue list --label <name> --limit 1000 --json number` prints `[]` and exits with 0.
  Without `--json`, the command prints nothing and exits with 0 (gh 2.102.1, measured on 2026-10-24). So an empty list
  does not show that the label exists. Before a plan rests on a label, the agent runs `gh label list --limit 1000` and
  makes sure that the label is on the list. A rule that rests on a label also makes sure that the label exists. On #376,
  the label `broken-test` did not exist. A design gap answered this: the label is made outside the ticket, and the user
  created it on 2026-10-24.
- If a requirement of the issue gives a reason as a fact about a command or a flow, test that fact against the code of
  each case before the first refine, as [the issue check](plan-review.md#the-issue-check) does for a claim. On #365, the
  issue said that each refine of a pushed task puts the branch in the note case. A refine with an amend gets the at-risk
  error instead. Review 2 found this, and a change of scope of the user narrowed the sentence. It cost one loop. This
  also covers a reason that a hint or a refine adds about a state: before the feedback asks for it, search the docs for
  each rule that changes that state. The search follows [the doc-search rule](rules.md#docs). On #423, refine 1 asked
  for "origin keeps the push of an earlier step 9 until step 21", and review 3 found that the pushed-branch rule of
  `docs/dev/verify-failures.md` can delete that push earlier. It cost one loop.
- If the issue gives a reason with a condition, for example "a failure would stop each update", ask the plan for the
  form "If X, Y" in the first refine. The simple-english skill bans "would". A plan that only drops the word loses the
  condition. On #365, this happened.
- A search or a check command of the plan, for example a `grep` count or a claim that a doc does not hold some words, is
  a fact of [the fact test](plan-review.md#the-fact-test). Before `tasker approve`, the agent runs it on each form of
  the words, for example `--opt=value` next to `--opt value`. The search follows [the doc-search rule](rules.md#docs).
  On #392, a pattern of plan v2 needed a space before `$HOME`, and it counted 2 on the correct line. Refine 2 fixed it.
  On #388, plan v1 searched only for "the bullet before it" and missed "the bullet before this one" in
  `docs/dev/planner.md`. The issue check found it with `grep -n -E 'the bullet before (this one|it)'`. On #383, a search
  for `base branch:` also hit prose where a colon ends a phrase before a code span, and the expected output of the plan
  missed one such hit. Sort each hit before the plan calls one hit the only one.
- In a ticket with an npm fact test, the agent runs the fact test and gives the results in the feedback. The execute
  session runs no fact test and no `npm install -g`, also not with `--prefix`. On #416, plan v1 put such a test in the
  execute session.
- For a fact test of the installed tasker, point `TASKER_CONFIG` to a scratch `config.json` with its own `dataRoot`, a
  local bare remote, and `updateOnStart` and `updateOnFinish` set to `false`. A `git clone --bare` of the local clone
  copies its local task branches, so delete them in the scratch remote. Otherwise `tasker update-branch` reports that
  the branches diverged. After the test, abort the scratch task, and make sure with `cmp` that the real configuration
  did not change. On #370 (2026-10-24), the agent ran the fact test of the exception of #393 this way.
- A rule about the states of the installed tasker does not link to `docs/statemachine.md`, because that page describes
  the tasker that this repo builds. On #147, the plan linked to it. In a ticket about the installed tasker, also ask the
  plan not to take facts about it from `docs/statemachine.md` or from the code of this repo. These also describe the
  tasker that this repo builds. On #356, plan v1 of a hint ticket took a fact from `docs/statemachine.md`. For
  `skills/tasker/`, see [The installed skill](rules.md#the-installed-skill). On #198, the plan took the output form of
  `tasker status` from `skills/tasker/references/inspect.md`. On #229, the plan took the text of an empty-feedback error
  from `src/tasks/refine.ts`. The same reason answers a review finding that takes a fact about the installed tasker from
  `docs/statemachine.md` or from the code of this repo (`src/`). The agent can expect such a finding in a ticket that
  records an output of the installed tasker. On #283, #290 and #302, the review did this with `docs/statemachine.md`. On
  #321, finding 1 of review 1 said that `tasker review` reads only the commits of the task, with
  `src/vcs/git/changes.ts` and `src/tasks/review.ts` as evidence. The issue said that the review of a stacked task also
  reviews the lines of its parent (#271), and the agent dismissed the finding with the issue text.
  [The facts of the installed tasker](tasker-commands.md#the-facts-of-the-installed-tasker) say how a session treats a
  fact of the earlier implementation.
- In a ticket about the installed tasker, tell the plan that "the task worktree" is the worktree of the agent, as
  [the own-worktree rule](limits.md#the-own-worktree-rule) says. The worktree that tasker makes for a task is a worktree
  of tasker. On #366, plan v1 used "the task worktree" for the worktree of tasker.

## A ticket that only adds a layer, for example a schema

- Say that the wiring is out of scope. Otherwise the review finds "a key that nothing reads".

## A ticket that changes git code

- Give the design context of [version-control.md](version-control.md#how-tasker-uses-git) up front. Otherwise the review
  raises cases that cannot occur.
- Test on the local machine each mechanism that the refine names, and the user configuration keys of each git command
  ([the fact test](plan-review.md#the-fact-test)). On one ticket, `-c core.bare=true` had no effect, and three
  configuration keys gave a wrong result with no error.
- Name the rules of [version-control.md](version-control.md) and [workspaces.md](workspaces.md) that the code must
  follow, for example [the environment of git](version-control.md#rungit) and
  [the exact ref reads](workspaces.md#revisions).
- Name the disk state of each path: fresh, partial and complete. For a configuration key with more than one value, name
  the `--replace-all` and `--unset-all` rules of [The clone configuration](version-control.md#the-clone-configuration).
- A test that compares the output of tasker with "what git writes" reads the value of git with a separate plain git
  call, before tasker can change it.
- Git code that does not read the error text of git keeps two calls for "exists" and "read". Name the two-call pattern
  and its reason. Otherwise the review asks to merge the two calls.
- A promise in a doc about the environment names exactly what tasker removes and what still passes. A broad sentence
  such as "the caller cannot pass X" causes a finding.
- A test that must move a ref of origin between a tip read and a push cannot use a pre-receive hook. With git 2.47.3, a
  ref update inside the hook fails with `ref updates forbidden inside quarantine environment`. Use a git wrapper first
  on PATH that runs a command before each push. `test/helpers/git.ts` holds such a wrapper since #43. Each command
  inside the wrapper calls the real git by its path. A plain `git` inside the wrapper runs the wrapper again.
- Before the landing, the agent runs each test file of a command that makes git commits, for example with a rebase or a
  merge, with the global git configuration hidden: `GIT_CONFIG_GLOBAL=/dev/null npm test -- <test file>`. Then the tests
  run with no global git identity, as on the GitHub runner ([Tests](code-conventions.md#tests)). On #273, 21 tests of
  `test/commands/update-branch.test.ts` passed on the local machine and failed on CI. #287 fixed them.
- To find each test that needs [a git identity](code-conventions.md#tests), run the whole test suite with no global and
  no system git configuration: `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npm test`. On #287, this run took
  about 30 seconds. It showed that only the tests of `test/commands/update-branch.test.ts` had the gap.
- After a move of the head that is not a fast-forward, the code reads again each value that it read for the old head. An
  example of such a move is a take of the remote tip. An example of such a value is the containment of the base. On
  #294, review 1 found a base step that used the containment of the old local tip. That step can skip the rebase.

## A ticket that adds a check of `tasker doctor`

- A remediation names only the cause that it fixes.
- Name the timeout rules of [the shared wrapper](doctor.md#the-shared-wrapper) for each check.

## A ticket that adds an interface

- Give the full export map and a table of the neutral names.
- Name the compare rule for the tests of an operation
  ([code-conventions.md](code-conventions.md#add-an-operation-to-the-version-control-provider)).
- Make sure that each member signature obeys the sharing rule of the interface. For example, a provider that is shared
  for each `(id, account)` cannot know the project of a repo, so its `parse` takes `project`
  ([issue-trackers.md](issue-trackers.md#the-issue-provider)).

## A ticket that changes a path

- List each search hit of the old path with "change" or "keep", and the reason. Name the folders with a similar name.
  Name the tests that build the layout themselves.

## A ticket that moves code

- Before a ticket splits a file, ask the plan to list each local function of the old file (a function that the file does
  not export) and to name each new file that uses it. A local function that two new files use must go to one shared
  place ([rules.md](rules.md#tests)). Otherwise the split makes a copy (#140).
- If a move must keep the code exact, ask the plan for a scripted proof that execute runs and reports. A move changes
  each line of the file, so a read of the diff cannot show a dropped test or a changed body (#140). The proof compares
  the old and the new state in four ways:
  - The names of the exports.
  - The names and the count of the tests, from `npm run test:list -- --json`. Put `--json` last, or use the form
    `--json=<path>`, because Vitest reads the word after `--json` as an output path. On #220,
    `npm run test:list -- --json <file>` wrote the JSON list over a test file in the worktree. For a script that parses
    the output, ask for `npm run --silent` or `--json=<path>`. npm prints two banner lines before the JSON, so a parse
    of stdout fails. On #222, the agent found this.
  - A sorted diff of the bodies, without the import lines.
  - The import graph.
- If a refactor moves tests onto shared defaults, ask the plan to compare the old local builder with the shared builder.
  Ask the plan to list each value that only the old builder has. Ask the plan to say for each value if a test depends on
  it. On #220, review 1 found a round-trip test that lost its check of two different times.
- If a refactor moves steps of a command into a shared function, ask the plan to say where each input of the moved steps
  comes from. Ask the plan to pass an input that the caller already holds. On #180, the shared cleanup listed the
  worktrees a second time.
- A move of a shared helper leaves copies of its reason in the comments of its callers. Ask the plan for each such
  comment. On #61, [the diff read](run-one-ticket.md#the-diff-read) found them.

## A ticket that moves a task into or out of a group of states

- The transition code must go through the new functions. Otherwise other paths, for example a failure or an abort, skip
  the rule.

## A ticket that writes files outside the sandbox

This section covers a ticket that writes files outside the sandbox, on paths that the sandbox can write.

- Refuse a symlink in each part of the path, not only in the last part.
- Give the rules for a symlink and for a missing file of each helper that writes files.

## A ticket with test fixtures

- Name the import rule of `test/fixtures/` ([code-conventions.md](code-conventions.md#layout)).
- The agent can record fixture data on the local machine and put it in the refine with "write them exactly as given".
  About 45 KB worked. Then the agent compares each file with `cmp` against `tasker/<task branch>`.
- If an issue asks that each test of a file gets a value from a fixture, ask the plan to name the fixture that each test
  of the file calls. Ask the plan to put the value in the inner fixture. Then the value reaches the tests that call the
  inner fixture and the tests that call an outer fixture that calls it. On #287, plan v1 put the git identity in
  `useMovedBaseTask`. Some tests of `test/commands/update-branch.test.ts` call `useWorkReviewTask` directly, so refine 1
  moved the identity into `useWorkReviewTask`.
- A command test makes a commit on the task branch with `commitInWorktree`, not with `addCloneCommit`. `addCloneCommit`
  moves the branch ref in the clone and not the worktree that has the branch checked out. On #274, the issue named
  `addCloneCommit`, and the tests used `commitInWorktree` and `origin.addCommit()` instead.
- If a ticket makes `tasker start` read a new source through `gh`, ask the plan to give `useStartFixture` a default
  answer for that source. Without it, each test built on that fixture fails with an unanswered `gh` call. The default
  answer comes after the answers of `ghAnswers`, because the first answer of the fake `gh` that matches wins. On #275,
  the plan found this for the read of the blockers.
- A test of a pause that the state machine cannot reach from the origin, for example `quota_blocked` from
  `updating_branch`, cannot use `pauseTaskFrom`, because that helper throws. The test uses `placeTask` and writes the
  `transition` event itself, because `placeTask` writes no event. On #278, the test setup needed both. If a second test
  needs this setup, it becomes a shared helper.
- A test that puts a fake `npm` or a fake `tasker` first on PATH never removes the fake and never makes it not
  executable. If a test removes the fake or makes it not executable, the PATH lookup finds the real installed program.
  The test then runs the real `npm install -g` or the real `tasker install-skills`, and that run replaces the installed
  tasker. As a result, a test of the "the program did not start" path of such a script is not safe. On #395, the tests
  covered only the signal path.

## A ticket that changes a procedure doc

- Say who runs each step, with which binary, in which repo and path, and the state of the task after each command. Each
  git command of a step names the checkout or worktree where it runs, for example the local clone or the worktree of the
  task. The agent of #144 learned this in its review loops.
- Give each command step a failure case for any error, and name what stays behind.
- For a read-only command, a missing match is an answer, not a failure. For example, `git grep` with no match exits with
  1, and `git show <commit>:<missing path>` exits with 128. Say so in the first refine. Otherwise the plan asks for a
  failure case for each such command (#114). A missing path of `git show <commit>:<path>` has two error texts, and both
  exit with 128. Also, `git show` does not resolve `..` in a path, so a rule that reads a link target resolves the path
  first. [The doc-read rule](doc-reads.md#the-doc-read-rule) gives the two error texts and the `..` fact. On #411,
  review 1 found that a sentence named only the text "does not exist in".
- Do not write "go to step N" without a condition. Define each term, for example "loop". Do not list a step two times.
- A ticket can define a common word. Then ask the plan to find each use of the word in another sense on the same pages.
  On #334, "stop" also meant the end of the work, and a link on "stops" narrowed a condition. This cost two review
  loops.
- A rule that names `tasker review` covers each outcome: findings, no findings, all findings dismissed, and new findings
  after `tasker update-branch`. Start a rule with the state ("If the task is in X ..."), not with the steps that lead to
  it.
- A rule that names an earlier and a later ticket covers the swap of the roles when the order changes.
- For the side-effects hint of [All tickets](#all-tickets), ask for the side effects of each edit on the whole page.
- Make sure that each numbered list still renders. An edit can join two items on one line. In a ticket that removes the
  last sentence of a list item, ask the plan to keep the line break of the item. The execute session removes the line
  break with the sentence, and two items then sit on one line. Ask the plan to search the result for a step number after
  a period, for example with `grep -n -E "[^0-9][.] ?[0-9]+[.] "`. On #266, this cost one review loop. The search
  follows [the doc-search rule](rules.md#docs).
- A fenced code block at column 0 inside a numbered list ends the list. Then `npm run format:check` can fail, for
  example when indented text of the same step follows the block. Indent the block three spaces. On #119, this cost a
  loop.
- Scope a new rule narrowly. A ban on X everywhere clashes with docs that must name X to describe a behavior. Compare
  each sentence that scopes a case out ("the rules do not cover X") word for word with the issue. On #165, the plan
  turned such a sentence into a ban ("X does no handoff").
- If an issue adds an exception to a paragraph that holds several bans, ask the plan to list each ban of the paragraph.
  For each ban, the plan says whether the exception covers it. On #271, the exception "a read that the user permits" and
  the ban "never read, search or run anything in a worktree of tasker" disagreed. Review loop 1 found it, and the user
  decided that the exception does not cover a worktree.
- If an exception needs its own git test, offer the user the rule with no exception as the first choice at once. Do not
  wait for the two loops of [Simplify over special rules](working-with-the-user.md#simplify-over-special-rules). On
  #302, loops 2 to 4 each found a new edge case in the test, and the user dropped the exception.
- If a ticket adds a rule that bans an action in the reply to the user, ask the plan for a scope bullet. Before
  `tasker approve`, the agent decides whether the issue covers two cases: a request in the form of a question, and an
  offer that another doc requires. On #259, review 1 found both cases, and the agent
  [dismissed them with the words of the issue](review-findings.md#review-findings).
- If an issue names an example doc for a new rule, ask the plan to make the example sentence claim only the one fact
  that the rule needs. Also ask the plan to list the sentences of that doc that the rule still bans, so that the agent
  can report them in [its final report](run-one-ticket.md#the-final-report). On #258, review 1 tested the whole example
  doc against the new rule.
- If a step contains a nested step with its own result, say what each result means for the outer step. The failure rule
  of the outer step must name each result of the nested step. The agent of #125 learned this in its review loops.
- Ask the plan to copy the exact condition of a nested check into each place that links to it, for example an exit code
  of `git cherry` (#163). The outer step owns the stops and the "continue" sentences. Each check owns its own cases, and
  a link keeps only the condition. On #206, a full copy next to each link drew duplication findings in loop 1.
- If one rule has two actors of the same kind, for example an earlier and a later task, name the actor in each sentence
  (#125).
- If one rule has two kinds of actor, for example the orchestrator and an agent, ask the plan to list each sentence with
  its actor. Otherwise the review finds each failure path that names only one actor (#135). If a rule lets an agent get
  something through the orchestrator, ask the plan to say who does the action. On #271, review loop 2 found that the
  text did not say who does the permitted read for an agent. The user decided that the orchestrator does the read and
  gives the fact to the agent as an answer.
- If a rule waits for a report from another orchestrator, it also gives that orchestrator the duty to send the report.
  Otherwise the wait has no end. On #147, review 1 found this gap. If a rule ends a wait on named events, ask the plan
  for an end case when the waited object leaves the flow. On #238,
  [the parent hold](pick-the-tickets.md#the-parent-hold-rule) also ends when the issue of the parent closes.
- A rule that says "the order of X wins over the hold" also tells X to send that order to the held agent. The order is a
  message to the held agent, for example from the orchestrator, not a landing order. Without that order, the held agent
  reads only [the parent-hold rule](pick-the-tickets.md#the-parent-hold-rule), and the deadlock (each side waits for the
  other) stays. On #302, review loop 6 found this.
- If a rule adds a new way to unblock a ticket, for example an approved blocked-by link, ask the plan for a moment that
  reads the states at once. Otherwise the ticket waits until the next landing. On #227, review 2 found this gap.
- If a rule records a commit of the shared clone, the rule reads the hash before the work that the hash stamps. Another
  agent can move the clone between the read and the work, as [the shared-clone rule](limits.md#the-shared-clone-rule)
  says. The review of #135 found this race in [the re-read rule](doc-reads.md#the-re-read-rule).
- If a rule records a value, say how long the value lives. Cover each later step that uses it, also on another page. On
  #163, loop 1 found this gap. Also ask the plan to name the end of the life of the value across a second round of the
  same procedure. On #231, review 1 asked how long `<deleted>` lives when a second rebase conflict pushes the branch
  again.
- If a rule keeps a resource for a later start, ask the plan for the moment when the rule no longer keeps it. On #429
  (2026-10-25), review 2 found that the hold of the parent continued after the start of the stacked agent. As a result,
  the rule counted the kept slot twice.
- If a new rule deletes a thing that a check reads, for example the tip on origin, ask the plan to
  [name the hash one time](limits.md#the-shared-clone-rule). Ask it to use that name in each sentence of the check, also
  in its pass sentence. On #231, review 2 found the pass sentence with the old name.
- In a ticket that changes the quota rules, give in the first refine [the fact test](plan-review.md#the-fact-test) that
  the quota event gives only the windows `five_hour` and `seven_day`, for example with
  `tasker show-quota | jq 'max_by(.receivedAt).event.rate_limit_info.unifiedWindows | keys'`. On #232, this fact settled
  two review findings.
- If a rule runs at each read of a value, ask the plan to put the rule right after the read, not inside a branch such as
  "If there is a reset time". On #232, review 1 found that a stale five-hour time gave no
  [seven-day job](quota.md#terms).
- If a ticket turns one job of a ticket into two, ask the plan to find each rule that leaves an agent out or schedules
  no new job. Ask it to make sure that each such rule is true for the other job that still lives. On #232, review 1 and
  review 3 found such a case.
- A rule takes a fact about one event from the report of that event, not from a diff since the last read. An example is
  the landed commit with its files. Several agents can land close together, and then the diff covers more than one event
  (#135).
- If a rule reads a comment of an issue, ask the plan to name the account whose comment counts. Also ask the plan to
  cover more than one such comment. [The issue check](plan-review.md#the-issue-check) gives the reason. On #247, reviews
  1 and 2 found these two gaps one at a time.
- If the plan searches for the sentences that hold a term, ask for a pattern that also stops at a colon, for example
  `[^.:]*`. The search follows [the doc-search rule](rules.md#docs). The pattern `[^.]*` misses the lead-in of a list,
  which ends with a colon. On #152, the plan and the agent missed one line this way, and it cost one loop.
- If a rule takes sentences from one case for a new kind of case, ask the plan whether each borrowed sentence fits the
  new kind. On #139, a sentence for a false claim let a conflict skip the refine that changes the plan.
- If a rule says "use X in place of Y" for a message, say if it means the address or the text of the message. On #143,
  "the issue key in place of the session name" had a reading where the message went to the issue key as an address.
- A shared failure sentence after a chain of checks names the real stop cases. If one check hands over to the next, the
  sentence otherwise reads as a stop at each check (#163). Ask the plan for one general rule, not a list of the stop
  cases that other steps own. On #206, a list of the cases was not complete, and review 2 found it. The same holds for a
  sentence such as "each step that uses X stops, as that step says". If one such step does not stop, the sentence claims
  too much. Ask the plan for "each step does what it says for that case", with the steps that stop as examples, not a
  full list. On #419 (2026-10-25), review 4 found that [the same-patch rule](review-findings.md#review-findings) counts
  the review after the update as a loop and does not stop.
- If a rule lets an agent skip a step, it names each later bullet that no longer applies. On #147, the early update had
  to switch off the update of the bullet "When the issue of the earlier ticket is closed". If the step that the agent
  skips depends on a fact that the rule takes away, the rule also tells the actor that skips the step. On #187, the rule
  took away the landing order, but the fourth case of the stop rule still stopped the agent. Review 1 then asked for a
  message to the agent. Such a rule can also replace a sentence in a bullet that runs at another moment. Then ask the
  plan to say when the skip applies. On #192, loop 1 found that the words "gives the next step" can send the agent past
  the refine of step 8 of [Run one ticket](run-one-ticket.md#run-one-ticket).
- If a rule adds a new path to an existing step, ask the plan to search the whole paragraph of that step for the words
  of the old path. Ask it to fix each such sentence in one commit. The search follows
  [the doc-search rule](rules.md#docs). On #198, three review loops found the words "in an answer", "that sends the
  answer" and "a comment of the orchestrator" one sentence at a time. The same search applies when a ticket turns some
  statements into "not a claim": ask the plan to scope each later sentence of the same paragraph that names an output or
  a claim. On #393, review 1 found the measure sentence of [the issue check](plan-review.md#the-issue-check), and it
  cost one loop.
- If a rule lets the user choose to skip a ban, for example with the answer "start now", ask the plan to say which rule
  wins in each case that the rule covers. Cover a task of the same milestone and a task of another milestone. On #145,
  review 1 found this gap.
- If a rule offers the user a choice, ask the plan to say what happens to later offers after the user says no or the
  command fails. On #227, review 1 found that the same offer came back at each read of the board.
- If a rule changes how an agent ends its turn, ask the plan to list each place on the page where the agent ends its
  turn or gives a report. Also ask for each place where the orchestrator reads the last report. On #166, each fix drew a
  new case, and the work took 4 loops.
- A summary line that points to a rule promises no more than the rule gives. On #138, line 20 of
  `docs/dev/orchestration.md`, in "Pick the tickets", said "no orchestrator", but the rule covers only an orchestrator
  that knows of the issue.
- If a rule covers a message from one orchestrator to another, say in the first refine what the rule does for the
  sender. Also say what it does for a reject and for no answer, or say that these cases are out of scope. On #164,
  review 1 found both cases.
- If an issue adds a second trigger to a bullet, ask the plan how the two triggers fit together. A trigger is the event
  or state that starts the action of the bullet. On #244, review 1 found two moments to tell the user: "When the Todo
  column is empty" and "when the last ticket closes".
- If an issue limits a rule to one session, for example "the session that got it", the first refine compares that limit
  with [the items of a handoff file](handoff.md#the-items-of-a-handoff-file) before the plan. The handoff file carries
  each decision of the user to the new session. On #375, the issue limited
  [the recommendation mode](working-with-the-user.md#a-decision-of-the-user) to the session that got it. Review 1 found
  the conflict with the handoff, and the fix cost a change of scope.
- A new check of a fact, next to an old check of the same fact, draws a "two checks can disagree" finding. In the first
  refine, ask the plan whether the new check replaces the old one, and which check ends the rule. On #376, the label
  check and the old state read of `gh issue view` both ended the ban. The fix removed the old read.
- Define a group of rules by its condition, not by its words. A definition by words, for example "a rule that names the
  earlier ticket", also catches a rule that only names a bullet of a landing order, for example the no-loop-left rule. A
  definition by condition, for example "a rule that applies only when a landing order exists", does not. On #338, review
  1 found this. On #371, "each fetch" in a list of reads also caught a fetch that the issue does not name. Name each
  fetch by the read that it comes before.
- If a rule puts an action in a report or a reply, ask the plan to name the doc that defines that report. Also ask the
  plan to say which rule of the replies wins for it. On #399, the rule put the handoff suggestion "in its report of that
  landing". Review 1 found that no doc defines a landing report, and that a counted event that is not a landing has no
  such report. Review 2 found that the fix, "its next reply", clashed with the rule for an answer to a question of the
  user. The orchestrator answered each finding in its own design-gap comment on #399, one loop at a time.
- If a ticket adds a fact that names a fix for a `tasker verify` failure, compare the fact with
  [the verify-failure rule](verify-failures.md#the-verify-failure-rule) before the first refine. On #366, review 1 found
  that the rule sent such a failure to a retry and a stop. The user then added a sentence in a change of scope.
- If a rule or a design-gap answer reads a value from a source, for example the `based on` note of `tasker start`, ask
  for the case when the source is missing. On #344, review 3 found this gap, and it cost one loop.
- If a ticket lets an orchestrator run a ticket of another milestone, ask the plan to list each rule that finds the
  orchestrator of a task by the milestone of its issue, for example the bullet on a change to an issue in flight and the
  overlap rule. On #368, the review found such a rule after the plan.
- If a rule defines a form, for example "the plain form of a read is ...", ask the plan to also state the duty, for
  example "the agent runs each read in its plain form". On #371, review 2 found a definition with no duty, and it cost
  one loop.
- If a rule limits a denial or a failure to one event, for example "a denial at one update does not skip the reads at
  the next update", ask the plan to say which event a read before and a read after the event belongs to. On #371, review
  1 found two readings.
- If a ticket adds a rule in a new bullet beside a closed list, for example a list that says "gives only ...", ask the
  plan to also add an item to the closed list that points to the new bullet. Otherwise the two bullets disagree. On
  #417, review 1 found this.
- If a rule adds a reader to a section, ask the plan to keep the readers sentence at the top of the page true. On #415,
  refine 1 added the new reader to the readers sentence of `docs/dev/plan-review.md`, which the issue did not name.
- If a requirement adds a case to an existing condition, ask the plan to name the gaps of the old case that stay outside
  the issue. Then the agent dismisses a finding on such a gap at once. On #420, review 1 found such an older gap in the
  bullet on a change to an issue in flight.
- If a rule makes a step run again, ask the plan in the first refine for two things. First, the second run skips each
  job that the first run made. An example is each job that the first run of a step scheduled under
  [the future-time rule](quota.md#schedule-a-job-when-an-agent-starts). Second, the rule names what the second run does
  for each of its jobs, not only for the job that started the second run. On #431 (2026-10-25), review 5 found both gaps
  in the future-time rule.
- If a ticket adds a stop to one step, ask the plan to look for each other step that uses the same input. An example of
  an input is the base commit. The plan adds the same stop there. On #419, step 4 of
  [the commit check](verify-failures.md#the-commit-check) got its stop. Reviews 1 and 2 asked for the missing stop in
  the refine of step 4 of [Run one ticket](run-one-ticket.md#run-one-ticket) after a `tasker update-branch`, which
  [the broken-commit steps](verify-failures.md#the-broken-commit-steps) describe.
- If a rule leaves out one kind of task, ask the plan to count each task, not each file. On #427 (2026-10-25), an
  exception to [the stop rule](plan-review.md#the-stop-rule) for each file hid a file. The task shared that file with
  another task of the same kind. This happened when the warning also listed that file for a task of the other kind.
  Review 2 found it.
- If a procedure waits for a session to stop with `herdr agent wait`, the procedure also covers the state `blocked`.
  Without `--until`, the wait also ends in `blocked` (herdr 0.9.3, `herdr agent wait --help`). A wait that ends exits
  with 0, and the state is at `.result.agent.agent_status`. A timeout exits with 1 and prints
  `{"error":{"code":"timeout",...}}`. The agent of #403 measured both exits on 2026-10-24. Ask the plan to run
  [the fact test](plan-review.md#the-fact-test) for each exit that the procedure uses.
- A Claude Code session that starts with `--effort <level>` cannot see its own effort level, so its answer does not show
  it. The session can report its model. A [fact test](plan-review.md#the-fact-test) of the effort reads the screen of
  the session with `herdr agent read`. The start banner shows the effort, for example "Sonnet 5.5 with low effort". The
  status line also shows it, for example "[Sonnet 5.5 low]". The agent of #459 measured this on 2026-10-25, with Claude
  Code 2.1.310 through `herdr agent start` of herdr 0.9.3.
- A new page of a ticket can give the form of a message. Then each other step of the new pages that sends that message
  links to that rule. Ask the plan to search each message form across all the new pages. The search follows
  [the doc-search rule](rules.md#docs). On #403, one page said that an instruction of the user goes as "From the user:".
  Review 1 found a bare "stop" in step 1 of "Stop a session".
- If a hint or a plan line asks to cut a part of a list sentence, it also gives the full new sentence. On #405, a plan
  line said "remove only the false part" of a list sentence, and the execute session broke the list ("the drafts of each
  issue, their rewrites"). This cost refine 2 and review loop 2.
- Another ticket can change a later step of the same numbered list. Then the plan puts its new text inside an existing
  step, so that the numbers of the steps do not change. On #408 (2026-10-25), this kept the rebase onto #405 free of
  conflicts.
- If a rule limits a count of running agents, ask the plan in the first refine for a list. The list names each bullet
  that sets a count that a kept item must join. On #429, review 1 found that the bullet "Run at most 3 agents at the
  same time" counted only running agents.

## A ticket that moves or trims a doc

- Each kept rule keeps its conditions and its definitions. When a rule moves from one doc to another, keep every fact of
  each moved sentence. On #118, the moved UTF-8 rule lost its "reads" half. In a ticket that moves text, ask the plan to
  keep each old sentence and to change only the words that point to a place. On #206, a sentence that the plan reworded
  to make it "true" gained a fact, and review 3 found it. The one home of a merged rule covers each case of the old
  copies. If the [home](rules.md#code) of a merged fact uses a term that an old copy defined, ask the plan to move the
  definition to the home too. On #204, the home said "prunes" but not what the prune removes, and review 2 found the
  lost definition. If a ticket gives a term its one home, ask the plan to search the docs for each other sentence that
  defines the same term. The search follows [the doc-search rule](rules.md#docs). On #338, the parent-hold rule still
  said "A ready state is ...", and review 1 found it. On #342, plan v1 defined a free slot as "fewer agents run than the
  limit". A slot stays held until [Delete the job](quota.md#delete-the-job) frees it, also after the turn of the agent
  ends. Link to the home of the term, and do not define it again.
- A code comment can name a doc heading. Search `src/` and `test/` for a heading before a rename.
- Write a gap that no code covers yet as a rule for the caller with "must", not as a claim that the code does it.
- If the issue calls a sentence a copy of a home ([the one-home rule](rules.md#code)), ask the plan to compare the words
  and the scope of the two. A sentence under a section with another scope is not a copy. A copy can also hold one more
  fact. Before the agent dismisses a finding because it contradicts the issue
  ([Review findings](review-findings.md#review-findings)), the agent makes sure that the claim of the issue is true. On
  #199 and #202, a "copy" held another fact. On #202, the agent dismissed a real finding.
- If a rule moves from a narrow heading to a section for the whole page, ask the plan to keep the words that gave the
  scope of the old heading. On #199, a rule of "Revision input" read as false for the whole page.
- If a ticket turns the lead-in of a rule into a heading, ask the plan to read the first sentence of each rule again.
  After the change, a pronoun in that sentence can name nothing (#203).
- In a ticket that moves sections to another page, ask the plan to list each "this page" in the text that stays. The
  moved text is not the only place. The ticket changes each "this page" whose scope now covers a moved section. On #324,
  the [Limits](limits.md#limits) bullet "the steps on this page",
  [the verify-failure rule](verify-failures.md#the-verify-failure-rule) and two intro sentences became false. Review
  loop 1 found them.
- Ask the plan for a link on each name of a rule or a section that now lives on another page. The first use in each
  section gets the link. The links go in both directions: from the moved text and from the text that stays. A quoted
  name and a bare name both count. On #324, a rule only for quoted names left four bare names with no link, for example
  [the diff read](run-one-ticket.md#the-diff-read) and [the issue check](plan-review.md#the-issue-check). Loops 1 to 3
  found them one direction or one set of names at a time. On #322, the diff read found a quoted name,
  "[The prompt of an agent](pick-the-tickets.md#the-prompt-of-an-agent)", that the plan missed. A search for the bare
  quote with no `[` before it finds such names. The search follows [the doc-search rule](rules.md#docs). If a hint is
  about a form of text, for example quote marks, ask the plan to write each example of the hint in the exact form that
  the example describes. On #355, a new hint drew the difference between a quoted name and a bare name of a rule. The
  plan put quote marks around the bare-name examples, the diff read and the issue check, and review 1 found it. A hint
  of the orchestrator then asked for a link on each term that another doc defines. The plan put the links inside the
  quote marks, so the mistake was harder to see.
- An example sentence can name a section of a file, for example the sample notice of
  [the notice rule](doc-reads.md#the-notice-rule). After the move of that section, the file name changes, and the
  section name stays. On #322, the section name was swapped, and #324 fixed the same sample again.
- For the proof of a move, ask the plan to undo each expected link change with a `sed` pass. Run the pass on both the
  old text and the new text. A `sed` pass edits one line at a time. Prettier keeps each link on one line, so the pass
  still finds each link, as [the doc-search rule](rules.md#docs) says. But a changed link can move the line breaks of
  its paragraph. So compare the two outputs of the pass with `git diff --no-index --word-diff=porcelain`. Apart from the
  two header lines, a moved line break gives no line that starts with `-` or `+` in this diff. As a result, these lines
  show only the real differences. The agents of #322, #323 and #324 used this proof.
- If a hint keeps an old list item as its own sentence, first make sure that no kept rule of the page already says the
  same thing. Otherwise the kept sentence repeats that rule. On #338, a hint kept the fourth case of
  [the stop rule](plan-review.md#the-stop-rule) as its own sentence, and the sentence repeated the message bullet of
  [the Docs rule](land-the-work.md#the-docs-rule). Review 1 found the repeat.
- If a refine replaces repeated text with a pointer, the pointer names the thing, for example the reason or the rule,
  not "the same answer". On #373, "gets the same answer as such a plan" drew a finding in review 1.

## A ticket that adds a doc of rules or hints

- Name the docs that already hold some of the rules or hints, because they draw duplication findings (#116).
- Ask the plan to make sure that the new page has no repeats, and that each example link points to a doc that its
  lead-in names. If a hint links to a rule to prevent a repeat, put the link on the sentence that the rule supports, not
  on the new fact. On #149, review 1 found two links that only pointed near the topic.
- Before the agent asks a plan to extend a bullet, the agent runs `git blame` on that bullet. The issue can put the
  bullets of earlier tickets out of scope (#169). If an issue says to extend a hint that already gives part of a new
  hint, and it also puts the other hints out of scope, the issue names the hint to extend, as the bullet "An issue that
  adds hints to a page" of [The body of an issue](planner.md#the-body-of-an-issue) says, or the drafter says that the
  move of a sentence is in scope. On #219, the plan asked this question, and the answer cost one more stop before
  `tasker approve`.
- On #228, one hint of an issue used "check" as a verb, and the comment draft used "checked".
  [Before a post](issues.md#before-a-post) gives the self-check of each draft.
- If a hint of the issue starts with a rule that a doc already gives, ask the plan to state only the new fact. Then the
  old rule is only the source of an example, with a link. On #186, a link plus a restatement still counted as a copy,
  and it cost one loop.
- A hint that gives a read of a remote-tracking ref also gives the fetch before the read and the `--verify` of
  [the shared-clone rule](limits.md#the-shared-clone-rule). A hint about a value that changes later names the moment
  that it covers. On #169, review 1 found both.
- If the issue asks for a link to a bullet, make sure that the target has an anchor. A bullet has no anchor, so the link
  goes to the section of the bullet. On #167, the plan was unable to link to the duplication hint.
- In the first refine of a ticket that adds hints, if the issue puts the doc of the rule of a hint out of scope, say
  that a move of the hint into that doc is out of scope. On #214, review 1 asked to move a hint into step 7 of
  [the rebase-conflict procedure](rebase-conflicts.md#procedure), and the agent had to dismiss the finding.
- In a ticket that adds hints, if the issue says "the section that fits it", say "add no new section" in the first
  refine. On #228, plan v1 made a new section for one hint.
- If a hint uses a term that another doc defines, ask the plan for a link on the term, not a sentence that defines it
  again. On #214, the plan defined "[home](rules.md#code)" again, and review 1 found the copy.
- If a hint asks the plan for one sentence that covers the facts of two bullets, the hint also names the place of that
  sentence. An example of a place is "at the end of the second bullet". Without the place, the plan makes a design
  choice, and the agent stops under the second case of [the stop rule](plan-review.md#the-stop-rule). On #310, plan v2
  chose the end of the second bullet, and the question of that place cost one stop before `tasker approve`.
