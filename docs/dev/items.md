# Messages, questions and answers

This page gives the form of a message, the terms of the questions to the user and the answer.

## The form of a message

- The first line is one sentence that names the sender and the topic.
- Then the id follows, in the form `<own name>-<n>`. A progress report and a question of a question pane each have an
  id. The number `<n>` is the next number of the counter of the orchestrator, as [Terms](question-pane.md#terms) says.
  After a handoff, the count goes on from the first free id of the handoff file, as
  [The last item id](handoff.md#the-last-item-id) says.
- Then the text follows the rules of [A decision of the user](working-with-the-user.md#a-decision-of-the-user) and
  [The form of a reply](working-with-the-user.md#the-form-of-a-reply).
- The text of a message also gives the content of each issue that it names. The content stands next to the plain key, at
  the first mention of the issue in the message. [The issue-link rule](working-with-the-user.md#the-issue-link-rule)
  says what the content is.
- A message about a draft gives a summary of the draft and the path of the draft file, not the draft. The path is
  `/tmp/tasker/<slug>/drafts/<file>.md`.
- A progress report starts with the mark `Report:`, as [The operator](working-with-the-user.md#the-operator) says.

## The terms of the questions

This page uses these terms for the questions to the user.

- A question for the user alone is a question of one of these kinds:
  - A kind of choice of the list in the bullet that starts "The user can let the session decide open choices by its own
    recommendation" of [A decision of the user](working-with-the-user.md#a-decision-of-the-user).
  - A choice of [The rules for the user alone](planner.md#the-rules-for-the-user-alone).
  - A choice of [The state of the user](plan-review.md#the-state-of-the-user): the approval of a measure that changes
    the state of the user.
  - A choice of the fifth case of [the stop rule](plan-review.md#the-stop-rule).
  - A choice of the security report of [Review findings](review-findings.md#review-findings).
  - A choice of the earlier-blocker offer in [Pick the tickets](pick-the-tickets.md#pick-the-tickets): the orchestrator
    runs a blocker of an earlier milestone only on the word of the user.
  - A choice of the state `awaiting_quota_approval` in [Quota](quota.md#quota).
  - A choice of the question of a full stop of [the pi wait](quota.md#the-pi-wait): the resume of a task or another
    step.
  - A choice of a hold of [the hold rule](land-the-work.md#the-hold-rule) that stays until the user decides.
  - A choice of the bullet "Only the user changes a landing order of the overlap rule" of
    [Land the work](land-the-work.md#land-the-work), with its relay confirm.
  - A choice of [the stuck-task rule](land-the-work.md#the-stuck-task-rule).
  - A choice of each other rule that says that only the user does an action.
  - A tool block, as [the tool-block rule](tasker-commands.md#the-tool-block-rule) says.
- A partial answer is an answer of the user to some questions of one session that asks, but not to each question.
- An open question is a question with no answer of the user. If the pane owner judges that the words of the user do not
  fully settle a question, that question is also open. It stays open until the user says that the sender decides, picks
  a choice or fully settles the question. [The answer](#the-answer) gives these steps.
- An answered question is a question with an answer of the user that the pane owner did not send yet.
- A sent question is a question whose answer the pane owner sent to the session that asks.
- A moved question is a question that the report of a done milestone names as moved to a hold comment. A hold comment is
  a comment on a ticket on hold, as [A ticket on hold](pick-the-tickets.md#a-ticket-on-hold) says. A moved question
  needs no send.

## The answer

- The pane owner sends each settled answer to the session that asks, in the message of
  [The pane owner handles a decision](question-pane.md#the-pane-owner-handles-a-decision).
- The sender continues its other work and does not wait in a loop. The answer starts the sender again, as
  [the answer-wait rule](limits.md#the-answer-wait-rule) says for a task subagent. A partial answer also starts the
  sender again. The sender acts only on the answered questions. For the open questions, the sender continues its other
  work and does not wait in a loop.
- After a send works, each answered question of the message is a sent question. A question closes only after it is a
  sent question or a moved question.
- If a send fails, [the failure rule](limits.md#the-failure-rule) applies. The pane owner is the actor, and the
  questions of the failed send stay answered questions.
- A question can give choices, for example a, b and c. The words of the user to such a question can pick no choice and
  not fully settle the question. They can settle a part of it or none of it. The pane owner judges whether the words
  fully settle the question. This judgment is open on purpose. The two bullets after the next one cover only a question
  that gives choices.

  On 2026-10-25, orchestrator-docs asked in item orchestrator-docs-25 (#413) which words the skill gives as a reason.
  The user gave a use case, operator-docs sent it as the answer, and the user later said "let the orchestrator figure
  out the exact wording".

- If the pane owner judges that the words do not fully settle the question, the question stays open. The pane owner
  tells the question session what stays open, as
  [The pane owner handles a decision](question-pane.md#the-pane-owner-handles-a-decision) says.
- If the user says that the sender decides, the words of the user with that decision are the answer of the question. If
  the reply of the user picks a choice or fully settles the question, the reply is the answer of the question. In each
  case, the question becomes an answered question, and the send goes through the pane owner, as the first bullet of this
  section says.
- If the reply of the user does neither, the question stays an open question, and the pane owner sends nothing to the
  sender. The sender continues its other work and does not act on the open question.
- An answer of the user covers only each question that its message answers. The sender applies the answer to no other
  question that waits for an answer. This rule also holds for a planner or an orchestrator that gets the answer from
  another session. A question of another item waits for the answer of its own item. A planner that wants to apply the
  answer to a question outside an item asks that question first in a new item. An orchestrator asks it in its question
  pane at the time that the rules of that question give, for example
  [the open-question rule](pick-the-tickets.md#the-open-question-rule).

  On 2026-11-07, the user answered "a" to a question of item orchestrator-m16-5. planner-m16 also applied that "a" to a
  separate question in a comment on #723. That question had its own choices a and b, and it had no answer of the user.
  planner-m16 named this step in its report, and the user later chose a for that question too.
