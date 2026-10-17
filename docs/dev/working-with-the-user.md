# Working with the user

This page gives the rules for an assistant session that works with the user of this repo. It also says which kinds of work wait until later. The user is the person who works with the session. [planning.md](planning.md) calls this person the operator.

The rules apply to each session that works with the user, for example the orchestrator of [orchestration.md](orchestration.md) and the planning session of [planning.md](planning.md). They do not apply to the sessions that tasker starts for plan, execute and review.

The work on this repo must continue on any machine, as [What goes in a ticket](planning.md#what-goes-in-a-ticket) of planning.md says. For this reason, these rules are in the repo and not in the notes of an assistant.

## A decision of the user

- When the user must decide something, first explain in the reply what happened, what the problem is, and what each choice does. Then ask, and give a recommendation.
- Do not ask with a popup that holds only a short summary. In one case, the user rejected such a popup and wrote "I need more context. What is happening?".
- When you list open items or proposed issues, give each item what happened, why it matters and a recommendation.
- Define each term that the user did not see before, at its first use. An example is a label convention.
- Say what the code does. Do not write "by hand" or "manually" about code. This rule covers text about code. It does not cover an action of a person or a session, for example a change by hand to a clone. In one case, "the test opens the store by hand" read as if a session opened the files of tasker, which is not allowed. Write "the test writes the open and close steps itself instead of calling the helper".
- When you list the decisions that the user must make, give each question its own number in the main list. This also applies when two questions are about the same issue. Do not put a second question inside a bullet of another question. In one case (2026-10-15), a question about the link commands of #117 sat in a sub-bullet of the scope question of #117, and the user answered only the scope question.

## A question of the user

- When the user asks a question, answer only that question. Take no action and make no offer that the user did not ask for.
- This rule covers a question of the user. When the user must decide something, the session still gives a recommendation, as [A decision of the user](#a-decision-of-the-user) says.
- In one case (2026-10-17), the user asked the Docs orchestrator questions about its handoff. The orchestrator answered and also offered next steps. After one message of the user, the orchestrator left the handoff and started a ticket without the word of the user. The user wrote: "When I ask questions, just answer. Do not anticipate what I want."

## Core features first

- The goal is the core features of each command. An edge case waits until later. Do not ask the user about each edge case. Decide it as "later", and keep the ticket in its scope. The goal of the numbered milestones is parity with [the installed tasker](orchestration.md): each command of the installed tasker, with its core features. A feature that the installed tasker does not have also waits until later, as an edge case does.
- Two kinds of finding do not wait: a security gap and a bug in the core path. Tell the user about a security gap at once. [Review findings](orchestration.md#review-findings) of orchestration.md defines both terms and gives the steps for a finding of a review.
- Each piece of work that waits becomes an issue in its later milestone, as [The milestone of an issue](planning.md#the-milestone-of-an-issue) of planning.md says. [issues.md](issues.md) gives the steps to file the issue.
- Containers are out of scope for now. Do not raise or file an edge case that occurs only in a container. An example is a process that has the same pid at each start, so that the lock row of a crashed run looks like the lock row of the process itself.
- tasker writes and reads UTF-8 text only. The output code does not write raw bytes.
- A collision of derived names is not an issue. Examples are two repo keys or two [issue keys](issue-keys.md) that give the same slug, the same folder or the same task branch. Do not raise such a collision, and do not file an issue for it. When an agent reports one, dismiss it with this reason.

## Simplify over special rules

- When a review keeps finding edge cases in a rule, and each fix opens the next case, stop the patches. After two loops in a row where the fix of a rule draws a new edge case, give the user a simpler rule as the first choice and the patch as the second choice.
- In one case, an exception for one more loop drew a new edge case in each of 4 loops. The user replaced all the special loop rules with one rule: "up to 5 loops, then report". [Review findings](orchestration.md#review-findings) of orchestration.md holds that rule.

## The tools of a session

- Read a file with the Read tool of the session. Do not use `cat`, `head` or `sed -n` in a Bash call to read a file.
- The output of a command stays in Bash, for example the output of `gh` or `tasker`.
