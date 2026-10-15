# First refine

This page lists the hints for the first refine of a ticket, sorted by the kind of ticket. [orchestration.md](orchestration.md) defines the terms "ticket" and "agent", and [Review findings](orchestration.md#review-findings) defines a loop. The first refine is the first `tasker refine` of step 4 of [Run one ticket](orchestration.md#run-one-ticket).

A hint states what to ask the plan for, and why. When the plan gets the hints in the first refine, the review does not have to find them one loop at a time.

The agent gives each hint that fits its ticket in the first refine. The drafter of an issue can put a hint in the issue body ([planning.md](planning.md#the-body-of-an-issue)).

## All tickets

- Name the shared test helpers of `test/helpers.ts` that the tests must use ([rules.md](rules.md#tests)). Before a ticket adds a second test file of the same kind, move the shared setup into `test/helpers.ts`.
- Ask the plan for the side effects of each fix before `tasker approve`. A fix can cause a new finding about its own side effect.
- If a ticket adds a small exported helper, ask the plan for each place that does the same job ([rules.md](rules.md#tests)).
- If a function becomes the one home of a rule, the old callers use only its result ([the one-home rule](rules.md#code)).
- A ticket that adds a required option to a shared function breaks the callers that an earlier ticket landed. After the rebase, run `npm run check` and update those callers ([rules.md](rules.md#commits)).
- If a change removes a state that the tests depend on, ask the plan to search the tests for it and to name each hit.
- An explicit option from the caller is better than a detection inside a general helper. A detection causes findings about dropped errors and about cost.
- If a review finding depends on the timing of the event loop, ask for a failing test first. If execute cannot make a test fail, dismiss the finding with the evidence from the local machine.
- If tests wait in a loop, ask for one shared wait helper.

## A ticket that only adds a layer, for example a schema

- Say that the wiring is out of scope. Otherwise the review finds "a key that nothing reads".

## A ticket that changes git code

- Give the design context of [version-control.md](version-control.md#how-tasker-uses-git) up front. Otherwise the review raises cases that cannot occur.
- Test on the local machine each mechanism that the refine names, and the user configuration keys of each git command ([the fact test](orchestration.md#run-one-ticket)). On one ticket, `-c core.bare=true` had no effect, and three configuration keys gave a wrong result with no error.
- Name the rules of [version-control.md](version-control.md) that the code must follow, for example [the environment of git](version-control.md#rungit) and [the exact ref reads](workspaces.md#revision-input).
- Name the disk state of each path: fresh, partial and complete. For a configuration key with more than one value, name the `--replace-all` and `--unset-all` rules of [The clone configuration](version-control.md#the-clone-configuration).
- A test that compares the output of tasker with "what git writes" reads the value of git with a separate plain git call, before tasker can change it.
- Git code that does not read the error text of git keeps two calls for "exists" and "read". Name the two-call pattern and its reason. Otherwise the review asks to merge the two calls.
- A promise in a doc about the environment names exactly what tasker removes and what still passes. A broad sentence such as "the caller cannot pass X" causes a finding.

## A ticket that adds a check of `tasker doctor`

- A remediation names only the cause that it fixes.
- Name the timeout rules of [the shared wrapper](doctor.md#the-shared-wrapper) for each check.

## A ticket that adds an interface

- Give the full export map and a table of the neutral names.
- Name the compare rule for the tests of an operation ([code-conventions.md](code-conventions.md#add-an-operation-to-the-version-control-provider)).
- Make sure that each member signature obeys the sharing rule of the interface. For example, a provider that is shared for each `(id, account)` cannot know the project of a repo, so its `parse` takes `project` ([issue-trackers.md](issue-trackers.md#the-issue-provider)).

## A ticket that changes a path

- List each search hit of the old path with "change" or "keep", and the reason. Name the folders with a similar name. Name the tests that build the layout themselves.

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

- Say who runs each step, with which binary, in which repo and path, and the state of the task after each command.
- Give each command step a failure case for any error, and name what stays behind.
- Do not write "go to step N" without a condition. Define each term, for example "loop". Do not list a step two times.
- A rule that names `tasker review` covers each outcome: findings, no findings, all findings dismissed, and new findings after `tasker update-branch`. Start a rule with the state ("If the task is in X ..."), not with the steps that lead to it.
- A rule that names an earlier and a later ticket covers the swap of the roles when the order changes.
- Ask the plan for the side effects of each edit on the whole page.
- Make sure that each numbered list still renders. An edit can join two items on one line.
- Scope a new rule narrowly. A ban on X everywhere clashes with docs that must name X to describe a behavior.

## A ticket that trims a doc

- Each kept rule keeps its conditions and its definitions. The one home of a merged rule covers each case of the old copies.
- A code comment can name a doc heading. Search `src/` and `test/` for a heading before a rename.
- Write a gap that no code covers yet as a rule for the caller with "must", not as a claim that the code does it.
