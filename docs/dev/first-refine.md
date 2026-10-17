# First refine

This page lists the hints for the first refine of a ticket, sorted by the kind of ticket. [orchestration.md](orchestration.md) defines the terms "ticket" and "agent", and [Review findings](orchestration.md#review-findings) defines a loop. The first refine is the first `tasker refine` of step 4 of [Run one ticket](orchestration.md#run-one-ticket).

A hint states what to ask the plan for, and why. When the plan gets the hints in the first refine, the review does not have to find them one loop at a time.

The agent gives each hint that fits its ticket in the first refine. The drafter of an issue can put a hint in the issue body ([planning.md](planning.md#the-body-of-an-issue)).

## All tickets

- Name the shared test helpers of `test/helpers/` that the tests must use, and ask the plan to make each test call them. A local helper in a test file can call a shared helper, for example to fix the arguments of one `describe` block. It must not repeat the steps of the shared helper, for example a call of the same store function with its own default values. The review counts such a local helper as a copy (#127). Before a ticket adds a second test file of the same kind, move the shared setup into `test/helpers/` ([rules.md](rules.md#tests)).
- Ask the plan for the side effects of each fix before `tasker approve`. A fix can cause a new finding about its own side effect.
- If a ticket adds a small exported helper, ask the plan for each place that does the same job ([rules.md](rules.md#tests)).
- If a review or the diff read finds a duplication, ask the plan to search all of `src/` and `test/` for the same pattern, not only the files of the diff, and to fix every copy in the same refine. A copy can already be on the base branch, in a file that the ticket does not touch (#94). [Review findings](orchestration.md#review-findings) gives the duplication rule.
- If a review finding says that code crosses a module boundary, ask the plan to find each import across that boundary. A module boundary is the line between two folders of `src/`, for example `src/review/` and `src/plan/`. Such a finding can be an altitude finding, which names code at the wrong level, for example a general helper inside one command or one feature folder. Ask the plan to list each import from the other folder in the changed files, and to say for each one if it moves or stays, with the reason. Ask it to fix all of them in the same refine. On #153, the refine fixed only the one use that loop 1 named, and loop 2 found the next import from `src/plan/` in `src/review/`.
- If a function becomes the one home of a rule, the old callers use only its result ([the one-home rule](rules.md#code)).
- A ticket that adds a required option to a shared function breaks the callers that an earlier ticket landed. After the rebase, run `npm run check` and update those callers ([rules.md](rules.md#commits)).
- If a refine asks the plan to fix commits in place (a fixup commit and an autosquash rebase), give the base commit in the feedback. Get it with `git merge-base HEAD origin/<base branch>` in a worktree of the task branch, as [the commit check](orchestration.md#the-commit-check) does. [The broken-commit steps](orchestration.md#the-broken-commit-steps) already rebase onto it for a verify failure. Ask the plan to rebase onto that commit, not onto `origin/<base branch>`, and to make sure after each rebase that the merge base did not change. `origin/<base branch>` can move in the local clone after `tasker start`, and a rebase onto it also moves the task branch onto the new base (#94).
- If the feedback of a refine names the base commit of the task at `tasker start`, read it with `git fetch tasker` and then `git rev-parse --verify tasker/<task branch>` right after `tasker start`. Do not read it from the local `main`, because `main` can move after the start. On #150, the feedback said that `main` moved after plan v1, but the task had started on a later commit.
- If a change removes a state that the tests depend on, ask the plan to search the tests for it and to name each hit.
- An explicit option from the caller is better than a detection inside a general helper. A detection causes findings about dropped errors and about cost.
- If a review finding depends on the timing of the event loop, ask for a failing test first. If execute cannot make a test fail, dismiss the finding with the evidence from the local machine.
- If tests wait in a loop, ask for one shared wait helper.
- If the tests compare the literal text of a default fixture, ask the plan for one shared expected-text helper in `test/helpers/`. On #157, [the diff read](orchestration.md#the-diff-read) found the text of the default review findings copied in 4 test files, after a review with no findings.
- If a new sentence makes an exception to an earlier clause, the exact text says which one wins. For example, the dead-code rule of [rules.md](rules.md#code) keeps a function for a later ticket "also as an unused export" (#124).
- Ask the plan to add no reason that the issue does not give. On #121, a reason clause that the plan added on its own drew a contradiction finding.
- If the plan copies issue text, ask the plan to rewrite each word that the simple-english skill bans ([rules.md](rules.md#docs)). Examples are "should" and "could". On #120, the plan copied "could" from the issue, and four reviews missed it.
- A check of the docs in the plan must not write a file to the folder of the agent. The folder bullet of [Limits](orchestration.md#limits) names that folder. Process substitution, for example `diff <(cmd1) <(cmd2)`, needs no file. On #115, a plan step wrote a temporary file to the folder of the agent.
- If the ticket derives a name from a key, for example a session name from an issue key, say that a collision of derived names is not an issue ([Core features first](working-with-the-user.md#core-features-first)). Otherwise the plan raises the question (#115).
- If a plan step or a doc step points to a report, link to the item of the report, not to the step as a whole. On #120, a link to a step as a whole drew a finding.
- If a plan searches for the callers of a function, ask it to search each form of a use, not only `name(`. Examples are an import, a pass as a value, for example `map(name)`, and a call through another name. On #122, a search for `name(` missed callers, and a review loop found them.
- If the work of [the add-work rule](orchestration.md#the-add-work-rule) adds tests and code, ask the plan for a `test:` commit and then a `feat:` or `fix:` commit, as [Tests](rules.md#tests) and [Commits](rules.md#commits) of rules.md say. On #122, the work of the add-work rule put both in one commit.
- If the plan depends on a fact about a program on the local machine, for example the behavior of `claude` under a permission mode, measure the fact and give it in the first refine with the command and its result ([the fact test](orchestration.md#the-fact-test)). On #128, the plan session tried to get such a fact itself, outside the worktree.
- If the issue gives the exact form of a line, for example an index line of `AGENTS.md`, say "no other words after the colon" in the first refine. Otherwise the plan adds a lead-in, as other lines have. On #151, this cost one refine.
- Before the agent dismisses a finding about the text of a message, it makes sure that the text is true for that case. A false message is a bug, not an edge case that [Review findings](orchestration.md#review-findings) lets the agent dismiss. On #132, the agent first dismissed such a finding as an edge case. The error named a log file that does not exist, for a command that the deadline kept from its start.
- If a docs todo asks for reasons, give the plan the reasons that the issue lists. Then the session writes the reason, not only the rule. On #131, the first plan gave only the rules, and the diff read had to ask for the reasons again.
- The red `test:` commit ([rules.md](rules.md#commits)) of a new store method changes only test files and fails the type check, as in commit `97e8d2f`. Say this in the first refine. On #130, this kept the todo of the red commit clear.
- If a case cannot happen in a real run, ask the plan to test it through the function that builds the result or the message, not through a real run. On #132, a command that the deadline keeps from its start cannot occur in a real verify run. The reason: a command that runs at the deadline gets SIGTERM and is itself the failing command.
- In the diff read, also search for doc sentences that a new shared helper made false. On #133, a new shared read helper changed an error text, and the diff read found two doc sentences that it made false. On #132, the helper-name search of [the diff read](orchestration.md#the-diff-read) found a copied test helper after a review with no findings.
- If a new search hit adds a file that the issue does not list under Docs, compare that file at once with the plans of the tasks in flight. On #168, a new hit added `docs/dev/phases.md`, and a task of another milestone also changed that file.
- If a plan rewrites a sentence, ask the plan to keep the scope of each example and to add no reference that the old sentence does not name. On #168, one rewrite used "that rule" with no rule named before it. Another rewrite widened the example `HEAD` to "such a base".
- If a ticket writes files across the whole repo, for example a format run or a rename in each file, ask the plan to leave out the folder `.claude/`. The execute session cannot write some files under `.claude/`, for example `.claude/settings.json`. On #148, the format run left `.claude/settings.json` as it was, and the first `tasker verify` failed on it.
- If two test helpers share a one-line rule, for example a PATH prefix, ask the plan to put the rule in one shared helper up front ([rules.md](rules.md#tests)). On #43, a new git wrapper helper copied the PATH rule of a sibling helper, and review 1 found the copy. The fix cost one loop.
- Ask the plan to write no claim about a count in new text, for example "two functions fetch". Such a claim becomes false with each new case. On #199, the fix of a count drew a new finding in the next loop.
- If the issue gives a `gh issue list` command, ask the plan to add `--limit 1000`. By default, gh lists at most 30 issues (#200). [The priority rule](orchestration.md#pick-the-tickets) of `docs/dev/orchestration.md` holds such a command.
- If a page has two headings with the same name, the issue gives the exact anchor (#194).
- In step 7 of [the rebase-conflict procedure](rebase-conflicts.md#procedure), resolve only the conflict hunk. `git checkout --theirs <file>` takes the whole file. On #201, it dropped a word that another ticket had added. A script for the conflict chains its steps with `&&`, so that a failed step stops the script (#201).
- If the issue puts a command out of scope, ask the plan not to edit the docs of that command. On #159, the plan narrowed a reason sentence in the "Retry" section of [tasks.md](tasks.md#retry). Review 1 read the new sentence as a promise of a case that the ticket did not build.
- A link must support the exact sentence that holds it. Ask the plan to compare each link sentence with its target, for example "X says that Y". The target must say Y. On #159, a link sentence claimed more than its target doc says. [The diff read](orchestration.md#the-diff-read) found it after execute. On #212, the compare found a real gap before execute, because [docs/config.md](../config.md#assistant) names the provider `claude-code`, not the `claude` command.
- If a change makes an argument optional, ask the plan to list each doc sentence that depends on that argument, and to say for each one if it changes. On #159, the feedback of [`tasker refine`](tasks.md#refine) became optional. Review 2 found the sentence "a left-out question counts as answered by the feedback".

## A ticket that only adds a layer, for example a schema

- Say that the wiring is out of scope. Otherwise the review finds "a key that nothing reads".

## A ticket that changes git code

- Give the design context of [version-control.md](version-control.md#how-tasker-uses-git) up front. Otherwise the review raises cases that cannot occur.
- Test on the local machine each mechanism that the refine names, and the user configuration keys of each git command ([the fact test](orchestration.md#the-fact-test)). On one ticket, `-c core.bare=true` had no effect, and three configuration keys gave a wrong result with no error.
- Name the rules of [version-control.md](version-control.md) and [workspaces.md](workspaces.md) that the code must follow, for example [the environment of git](version-control.md#rungit) and [the exact ref reads](workspaces.md#revisions).
- Name the disk state of each path: fresh, partial and complete. For a configuration key with more than one value, name the `--replace-all` and `--unset-all` rules of [The clone configuration](version-control.md#the-clone-configuration).
- A test that compares the output of tasker with "what git writes" reads the value of git with a separate plain git call, before tasker can change it.
- Git code that does not read the error text of git keeps two calls for "exists" and "read". Name the two-call pattern and its reason. Otherwise the review asks to merge the two calls.
- A promise in a doc about the environment names exactly what tasker removes and what still passes. A broad sentence such as "the caller cannot pass X" causes a finding.
- A test that must move a ref of origin between a tip read and a push cannot use a pre-receive hook. With git 2.47.3, a ref update inside the hook fails with `ref updates forbidden inside quarantine environment`. Use a git wrapper first on PATH that runs a command before each push. `test/helpers/git.ts` holds such a wrapper since #43. Each command inside the wrapper calls the real git by its path. A plain `git` inside the wrapper runs the wrapper again.

## A ticket that adds a check of `tasker doctor`

- A remediation names only the cause that it fixes.
- Name the timeout rules of [the shared wrapper](doctor.md#the-shared-wrapper) for each check.

## A ticket that adds an interface

- Give the full export map and a table of the neutral names.
- Name the compare rule for the tests of an operation ([code-conventions.md](code-conventions.md#add-an-operation-to-the-version-control-provider)).
- Make sure that each member signature obeys the sharing rule of the interface. For example, a provider that is shared for each `(id, account)` cannot know the project of a repo, so its `parse` takes `project` ([issue-trackers.md](issue-trackers.md#the-issue-provider)).

## A ticket that changes a path

- List each search hit of the old path with "change" or "keep", and the reason. Name the folders with a similar name. Name the tests that build the layout themselves.

## A ticket that moves code

- Before a ticket splits a file, ask the plan to list each local function of the old file (a function that the file does not export) and to name each new file that uses it. A local function that two new files use must go to one shared place ([rules.md](rules.md#tests)). Otherwise the split makes a copy (#140).
- If a move must keep the code exact, ask the plan for a scripted proof that execute runs and reports. A move changes each line of the file, so a read of the diff cannot show a dropped test or a changed body (#140). The proof compares the old and the new state in four ways:
  - The names of the exports.
  - The names and the count of the tests, from `npm run test:list -- --json`.
  - A sorted diff of the bodies, without the import lines.
  - The import graph.

## A ticket that moves a task into or out of a group of states

- The transition code must go through the new functions. Otherwise other paths, for example a failure or an abort, skip the rule.

## A ticket that writes files outside the sandbox

This section covers a ticket that writes files outside the sandbox, on paths that the sandbox can write.

- Refuse a symlink in each part of the path, not only in the last part.
- Give the rules for a symlink and for a missing file of each helper that writes files.

## A ticket with test fixtures

- Name the import rule of `test/fixtures/` ([code-conventions.md](code-conventions.md#layout)).
- The agent can record fixture data on the local machine and put it in the refine with "write them exactly as given". About 45 KB worked. Then the agent compares each file with `cmp` against `tasker/<task branch>`.

## A ticket that changes a procedure doc

- Say who runs each step, with which binary, in which repo and path, and the state of the task after each command. Each git command of a step names the checkout or worktree where it runs, for example the local clone on `main` or the worktree of the task. The agent of #144 learned this in its review loops.
- Give each command step a failure case for any error, and name what stays behind.
- For a read-only command, a missing match is an answer, not a failure. For example, `git grep` with no match exits with 1, and `git show <commit>:<missing path>` exits with 128. Say so in the first refine. Otherwise the plan asks for a failure case for each such command (#114).
- Do not write "go to step N" without a condition. Define each term, for example "loop". Do not list a step two times.
- A rule that names `tasker review` covers each outcome: findings, no findings, all findings dismissed, and new findings after `tasker update-branch`. Start a rule with the state ("If the task is in X ..."), not with the steps that lead to it.
- A rule that names an earlier and a later ticket covers the swap of the roles when the order changes.
- For the side-effects hint of [All tickets](#all-tickets), ask for the side effects of each edit on the whole page.
- Make sure that each numbered list still renders. An edit can join two items on one line.
- Scope a new rule narrowly. A ban on X everywhere clashes with docs that must name X to describe a behavior. Compare each sentence that scopes a case out ("the rules do not cover X") word for word with the issue. On #165, the plan turned such a sentence into a ban ("X does no handoff").
- If a step contains a nested step with its own result, say what each result means for the outer step. The failure rule of the outer step must name each result of the nested step. The agent of #125 learned this in its review loops.
- Ask the plan to copy the exact condition of a nested check into each place that links to it, for example an exit code of `git cherry` (#163).
- If one rule has two actors of the same kind, for example an earlier and a later task, name the actor in each sentence (#125).
- If one rule has two kinds of actor, for example the orchestrator and an agent, ask the plan to list each sentence with its actor. Otherwise the review finds each failure path that names only one actor (#135).
- If a rule waits for a report from another orchestrator, it also gives that orchestrator the duty to send the report. Otherwise the wait has no end. On #147, review 1 found this gap.
- If a rule records a commit of the shared clone, the rule reads the hash before the work that the hash stamps. Another agent can move the clone between the read and the work, as [the shared-clone rule](orchestration.md#the-shared-clone-rule) says. The review of #135 found this race in [the re-read rule](orchestration.md#the-re-read-rule).
- If a rule records a value, say how long the value lives. Cover each later step that uses it, also on another page. On #163, loop 1 found this gap.
- A rule takes a fact about one event from the report of that event, not from a diff since the last read. An example is the landed commit with its files. Several agents can land close together, and then the diff covers more than one event (#135).
- If the plan searches for the sentences that hold a term, ask for a pattern that also stops at a colon, for example `[^.:]*`. The pattern `[^.]*` misses the lead-in of a list, which ends with a colon. On #152, the plan and the agent missed one line this way, and it cost one loop.
- If a rule takes sentences from one case for a new kind of case, ask the plan whether each borrowed sentence fits the new kind. On #139, a sentence for a false claim let a conflict skip the refine that changes the plan.
- If a rule says "use X in place of Y" for a message, say if it means the address or the text of the message. On #143, "the issue key in place of the session name" had a reading where the message went to the issue key as an address.
- A shared failure sentence after a chain of checks names the real stop cases. If one check hands over to the next, the sentence otherwise reads as a stop at each check (#163).
- If a rule lets an agent skip a step, it names each later bullet that no longer applies. On #147, the early update had to switch off the update of the bullet "When the issue of the earlier ticket is closed". If the step that the agent skips depends on a fact that the rule takes away, the rule also tells the actor that skips the step. On #187, the rule took away the landing order, but the fourth case of the stop rule still stopped the agent. Review 1 then asked for a message to the agent.
- A rule about the states of the installed tasker does not link to `docs/statemachine.md`, because that page describes the tasker that this repo builds. On #147, the plan linked to it.
- If a rule lets the user choose to skip a ban, for example with the answer "start now", ask the plan to say which rule wins in each case that the rule covers. Cover a task of the same milestone and a task of another milestone. On #145, review 1 found this gap.
- If a rule changes how an agent ends its turn, ask the plan to list each place on the page where the agent ends its turn or gives a report. Also ask for each place where the orchestrator reads the last report. On #166, each fix drew a new case, and the work took 4 loops.
- A summary line that points to a rule promises no more than the rule gives. On #138, line 20 of `docs/dev/orchestration.md`, in "Pick the tickets", said "no orchestrator", but the rule covers only an orchestrator that knows of the issue.
- If a rule covers a message from one orchestrator to another, say in the first refine what the rule does for the sender. Also say what it does for a reject and for no answer, or say that these cases are out of scope. On #164, review 1 found both cases.

## A ticket that moves or trims a doc

- Each kept rule keeps its conditions and its definitions. When a rule moves from one doc to another, keep every fact of each moved sentence. On #118, the moved UTF-8 rule lost its "reads" half. The one home of a merged rule covers each case of the old copies.
- A code comment can name a doc heading. Search `src/` and `test/` for a heading before a rename.
- Write a gap that no code covers yet as a rule for the caller with "must", not as a claim that the code does it.
- If the issue calls a sentence a copy of a home ([the one-home rule](rules.md#code)), ask the plan to compare the words and the scope of the two. A sentence under a section with another scope is not a copy. A copy can also hold one more fact. Before the agent dismisses a finding because it contradicts the issue ([Review findings](orchestration.md#review-findings)), the agent makes sure that the claim of the issue is true. On #199 and #202, a "copy" held another fact. On #202, the agent dismissed a real finding.
- If a rule moves from a narrow heading to a section for the whole page, ask the plan to keep the words that gave the scope of the old heading. On #199, a rule of "Revision input" read as false for the whole page.
- If a ticket turns the lead-in of a rule into a heading, ask the plan to read the first sentence of each rule again. After the change, a pronoun in that sentence can name nothing (#203).

## A ticket that adds a doc of rules or hints

- Name the docs that already hold some of the rules or hints, because they draw duplication findings (#116).
- Ask the plan to make sure that the new page has no repeats, and that each example link points to a doc that its lead-in names. If a hint links to a rule to prevent a repeat, put the link on the sentence that the rule supports, not on the new fact. On #149, review 1 found two links that only pointed near the topic.
- Before the agent asks a plan to extend a bullet, the agent runs `git blame` on that bullet. The issue can put the bullets of earlier tickets out of scope (#169).
- If a hint of the issue starts with a rule that a doc already gives, ask the plan to state only the new fact. Then the old rule is only the source of an example, with a link. On #186, a link plus a restatement still counted as a copy, and it cost one loop.
- A hint that gives a read of a remote-tracking ref also gives the fetch before the read and the `--verify` of [the shared-clone rule](orchestration.md#the-shared-clone-rule). A hint about a value that changes later names the moment that it covers. On #169, review 1 found both.
- If the issue asks for a link to a bullet, make sure that the target has an anchor. A bullet has no anchor, so the link goes to the section of the bullet. On #167, the plan was unable to link to the duplication hint.
